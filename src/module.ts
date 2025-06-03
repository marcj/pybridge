import { createModuleClass, onAppShutdown } from '@deepkit/app';
import { PyBridgeConfig } from "./config.js";
import { PyBridge } from "./bridge.js";

export class PyBridgeModule extends createModuleClass({
    config: PyBridgeConfig,
    providers: [
        PyBridge,
    ],
    listeners: [
        onAppShutdown.listen((event, python: PyBridge) => {
            // disconnect all open python processes when app shuts down
            python.close();
        })
    ],
    exports: [
        PyBridge
    ]
}) {
}
