from typing import List


def word_sizes(words: List[str]) -> List[int]:
    return [len(word) for word in words]


def stream() -> str:
    yield {'type': 'loading'}
    yield {'type': 'loaded'}
