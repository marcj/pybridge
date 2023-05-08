import {App} from "@deepkit/app";
import {PyBridge} from "../../src/bridge";
import {PyBridgeModule} from "../../src/module";
import {Subject} from "rxjs";

test('script', async () => {
    const bridge = new PyBridge({python: 'python3', cwd: __dirname});

    interface API {
        word_sizes(words: string[]): number[];

        stream(): Subject<{ type: 'loading' } | { type: 'loaded' }>;
    }

    const api = bridge.controller<API>('script.py');
    const sizes = await api.word_sizes(['hello', 'world']);
    expect(sizes).toEqual([5, 5]);

    const stream = api.stream();
    const values: any[] = [];
    stream.subscribe(v => values.push(v));
    await stream.toPromise();
    expect(values).toEqual([{type: 'loading'}, {type: 'loaded'}]);

    bridge.close();
});

test('app', async () => {
    const app = new App({
        imports: [new PyBridgeModule({
            python: 'python3',
            cwd: __dirname,
        })]
    }).command('test', async (python: PyBridge) => {
        interface API {
            word_sizes(words: string[]): number[];
        }

        const controller = python.controller<API>('script.py');
        const sizes = await controller.word_sizes(['hello', 'world']);
        expect(sizes).toEqual([5, 5]);
    });

    await app.run(['test']);
});