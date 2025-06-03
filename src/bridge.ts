import { ChildProcess, spawn } from "child_process";
import { isAbsolute, join } from "path";
import { findParentPath } from "@deepkit/app";
import { ConsoleTransport, Logger } from "@deepkit/logger";
import { deserializeFunction, ReceiveType, ReflectionClass, ReflectionKind, resolveReceiveType, Type, TypeClass } from "@deepkit/type";
import { Subject } from "rxjs";
import { PyBridgeConfig } from "./config";

interface RpcMessage {
    id: number;
    ready?: true;
    result?: any;
    yield?: any;
    error?: string;
}

function fromCode(code: string): string {
    return `
import sys
import types

module = types.ModuleType('my_module')
my_code = ${JSON.stringify(code)}
exec(my_code, module.__dict__)
`;
}

const hook: string = `
import sys
import traceback
import json
from typing import Generator

def debug(*args):
    print(*args, file=sys.stderr, flush=True)

# redirect all output to stderr
orig_stdout = sys.stdout
sys.stdout = sys.stderr

{{__load__}}

try:
    for line in sys.stdin:
        p = None
        try:
            # debug("got: ", line)
            p = json.loads(line)
            result = getattr(module, p['method'])(*p['args'])
            # if result is a generator, iterate over it
            if isinstance(result, Generator):
                for r in result:
                    message = {'id': p['id'], 'yield': r}
                    print(json.dumps(message) + '\\n', file=orig_stdout, flush=True)
                print(json.dumps({'id': p['id']}) + '\\n', file=orig_stdout, flush=True)
            else:
                print(json.dumps({'id': p['id'], 'yield': result}) + '\\n', file=orig_stdout, flush=True)
                print(json.dumps({'id': p['id']}) + '\\n', file=orig_stdout, flush=True)
        except Exception as e:
            if p is not None:
                message = {'id': p['id'], 'error': traceback.format_exception(*sys.exc_info())}
                print(json.dumps(message) + '\\n', file=orig_stdout, flush=True)
            print("Failed nlp method\\n", file=sys.stderr, flush=True)
            traceback.print_exception(*sys.exc_info(), file=sys.stderr)
except KeyboardInterrupt:
    sys.exit(0)
`;

function isSubjectType(type: Type): type is TypeClass & { typeArguments: [Type] } {
    return Boolean(type.kind === ReflectionKind.class && type.classType === Subject && type.typeArguments);
}

export class Controller {
    process?: ChildProcess;
    messageId: number = 0;
    subscribers: { [messageId: number]: (data: RpcMessage) => void } = {};

    constructor(private moduleNameOrCode: string, private config: PyBridgeConfig, private logger: Logger) {
    }

    ensureProcess(): ChildProcess {
        if (this.process) return this.process;

        let python = this.config.python;

        if (!isAbsolute(python)) {
            const venvBin = findParentPath('venv/bin');
            if (venvBin) {
                python = join(venvBin, python);
            }
        }

        let cwd = this.config.cwd;

        this.logger.log(`Start python via ${python} in ${cwd} for ${this.moduleNameOrCode.replace(/\n/g, '\\n').substring(0, 50)}`);

        let load = this.moduleNameOrCode.includes(' ') ? fromCode(this.moduleNameOrCode) : `import ${this.moduleNameOrCode} as module;`;
        if (this.moduleNameOrCode.endsWith('.py')) {
            load = `import sys; sys.path.append('${cwd}'); import ${this.moduleNameOrCode.replace('.py', '')} as module;`;
        }

        const code = hook.replace('{{__load__}}', load);
        // console.log(code);
        this.process = spawn(python, ['-c', code], {
            stdio: ['pipe', 'pipe', process.stderr],
            cwd: cwd,
        });

        const onExit = () => {
            this.process?.kill();
        }

        process.on('exit', onExit);
        this.process.on('close', () => {
            this.process = undefined;
            process.off('exit', onExit);
        });

        const buffer: Buffer[] = [];
        const read = (data: Buffer) => {
            buffer.push(data);
            // console.log('read', data.includes('\n'), Buffer.concat(buffer).toString('utf8'));
            if (data.includes('\n'.charCodeAt(0))) {
                const messages = Buffer.concat(buffer).toString('utf8').trim().split('\n');
                for (const message of messages) {
                    if (!message.startsWith('{"')) continue;
                    try {
                        const res = JSON.parse(message);
                        const messageId = res.id;
                        if (this.subscribers[messageId]) {
                            this.subscribers[messageId](res);
                        }
                    } catch (error) {
                        console.warn('Could not parse: ' + message);
                    }
                }
                buffer.length = 0;
            }
        }

        this.process.stdout!.on('data', read);
        return this.process;
    }

    send<T>(method: string, args: any[], type?: ReceiveType<T>): Subject<T> {
        const pythonProcess = this.ensureProcess();
        const messageId = this.messageId++;

        type = resolveReceiveType(type);
        if (isSubjectType(type)) {
            type = type.typeArguments[0];
        }
        const subject = new Subject<any>();
        const deserializer = deserializeFunction(undefined, undefined, type);

        this.subscribers[messageId] = (data) => {
            try {
                if (data.ready) {

                } else if (data.yield) {
                    const v = deserializer(data.yield);
                    subject.next(v);
                } else if (data.error) {
                    delete this.subscribers[messageId];
                    subject.error(new Error(data.error));
                } else {
                    delete this.subscribers[messageId];
                    subject.complete();
                }
            } catch {
            }
        };
        pythonProcess.stdin!.write(JSON.stringify({ id: messageId, method, args }) + '\n');

        return subject;
    }
}

type PromisifyFn<T extends ((...args: any[]) => any)> = (...args: Parameters<T>) => ReturnType<T> extends Subject<infer R> ? ReturnType<T> : ReturnType<T> extends Promise<any> ? ReturnType<T> : Promise<ReturnType<T>>;
export type RemoteController<T> = {
    [P in keyof T]: T[P] extends (...args: any[]) => any ? PromisifyFn<T[P]> : never
};

export class PyBridge {
    protected controllers: { [name: string]: any } = {};

    constructor(protected config: PyBridgeConfig, protected logger: Logger = new Logger([new ConsoleTransport()])) {
    }

    close() {
        for (const controller of Object.values(this.controllers)) {
            controller.process.kill();
        }
    }

    controller<T extends {}>(moduleName: string, type?: ReceiveType<T>): RemoteController<T> {
        if (this.controllers[moduleName]) return this.controllers[moduleName];
        const controller = new Controller(moduleName, this.config, this.logger);
        if (!type) throw new Error('No controller type T given');

        const reflectionClass = ReflectionClass.from(resolveReceiveType(type));

        return this.controllers[moduleName] = new Proxy({}, {
            get: (target, name: string) => {
                if (name === 'process') return controller.process;

                return (...args: any[]) => {
                    const returnType = reflectionClass.getMethod(name).getReturnType();
                    const subject = controller.send(name, args, returnType);
                    return isSubjectType(returnType) ? subject : subject.toPromise();
                }
            }
        }) as any;
    }
}
