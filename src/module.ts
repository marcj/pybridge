import {createModule, onAppShutdown} from '@deepkit/app';
import {PyBridgeConfig} from "./config.js";
import {PyBridge} from "./bridge.js";

export class PyBridgeModule extends createModule({
    config: PyBridgeConfig,
    providers: [
        PyBridge,
    ],
    exports: [
        PyBridge
    ]
}) {
    process() {
        this.addListener(onAppShutdown.listen((event, python: PyBridge) => {
            // disconnect all open python processes when app shuts down
            python.close();
        }));
    }
}