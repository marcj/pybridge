# PyBridge

A TypeScript library to access your python functions in NodeJS, type-safe and easy to use.

This is especially useful if you want to use machine learning models in NodeJS.

## Features

- Supports all TypeScript types (including generics)
- Supports generator functions in Python (streaming with RxJS)
- Python modules and scripts
- Automatically serializes and deserializes data between NodeJS and Python

## Use-cases

- Call arbitrary Python functions from NodeJS
- Use machine learning models in NodeJS
- Fine-Tune machine learning models from data coming from NodeJS (like Typescript ORMs)
- Text-Embedding from and to your database managed by NodeJS/TypeScript

## Usage

### Python

```python
# File: script.py
from typing import List


def word_sizes(words: List[str]) -> List[int]:
    return [len(word) for word in words]
```

### TypeScript

```typescript
// File: app.ts
import {PyBridge} from 'pybridge';

const bridge = new PyBridge({python: 'python3', cwd: __dirname});

interface API {
    word_sizes(words: string[]): number[];
}

const api = bridge.controller<API>('script.py');
const sizes = await api.word_sizes(['hello', 'world']);

expect(sizes).toEqual([5, 5]);

bridge.close();
```

If you use Deepkit Framework, you can PyBridgeModule:

```typescript
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

app.run();
```

In order to not pass the controller type to the controller function all the time, you can prepare your own controller
clas like that

```typescript
// file: python-controller.ts

interface API {
    word_sizes(words: string[]): number[];
}

interface NLP {
    embed(text: string): number[];
}

class PythonController {
    script = this.python.controller<API>('script.py');
    nlp = this.python.controller<NLP>('nlp.py');

    constructor(protected python: PyBridge) {
    }
}
```

And then use `PythonController` everywhere.

## Example Huggingface Sentence Embedding

```python
from sentence_transformers import SentenceTransformer

embedder = SentenceTransformer('paraphrase-MiniLM-L6-v2')  # 90MB model


def embed(sentence):
    # important to convert to list so json.dumps works
    return embedder.encode(sentence).tolist()


def batch_embed(sentences):
    for sentence in sentences:
        yield embed(sentence).tolist()
```

```typescript
interface ML {
    // Return type will be Promise<number[]>
    embed(text: string): number[];

    // Return type stays Subject, so values of `yield` will be streamed until the function is finished
    batch_embed(text: string[]): Subject<number[]>;
}

class PythonController {
    ml = this.python.controller<ML>('nlp.py');

    constructor(protected python: PyBridge) {
    }
}

const controller = new PythonController(bridge);

const embedding = await controller.ml.embed('hello world');
```

## Install

First install pybridge using npm:

```shell
npm install pybridge
```

Then install Deepkit (needed for type-safe data serialization between NodeJS and Python):

```shell
npm install --save-dev @deepkit/type-compiler
```

Enable Deepkit runtime type reflection:

File: tsconfig.json

```json
{
  "compilerOptions": {
    // ...
  },
  "reflection": true
}
```

## How it works

PyBridge starts a Python process and communicates with it via stdin/stdout.
It uses [Deepkit](https://deepkit.ai) to serialize data between the two processes. 

It's important to type the API controller in TypeScript correctly, so Deepkit can serialize and deserialize the data
correctly. Make sure it matches the Python function signature.
