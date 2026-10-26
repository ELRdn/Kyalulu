"""Incremental UTF-8/container framing; stdlib JSON validates scalar tokens."""
import codecs
import json
import re

STRING_BOUNDARY = re.compile(r'["\\]')
BARE_BOUNDARY = re.compile(r'[ \t\r\n{}\[\],:"]')


class JsonStream:
    # shortcut: decoded trees and scalar tokens stay whole; segment storage before 1 GB acceptance.
    def __init__(self):
        self.decoder = codecs.getincrementaldecoder('utf-8-sig')('strict')
        self.stack, self.pieces = [], []
        self.root, self.has_root, self.closed = None, False, False
        self.mode, self.escaped = '', False

    def invalid(self):
        raise ValueError('Invalid streamed JSON')

    def feed(self, raw):
        if self.closed: self.invalid()
        try: self.text(self.decoder.decode(raw))
        except Exception:
            self.closed = True
            raise

    def finish(self):
        if self.closed: self.invalid()
        self.closed = True
        self.text(self.decoder.decode(b'', final=True))
        if self.mode == 'bare': self.scalar()
        if self.mode or self.stack or not self.has_root: self.invalid()
        return self.root

    def value(self, value):
        if not self.stack:
            if self.has_root: self.invalid()
            self.root, self.has_root = value, True
            return
        frame = self.stack[-1]
        if frame['state'] not in ('value', 'valueOrEnd'): self.invalid()
        if isinstance(frame['value'], list): frame['value'].append(value)
        else: frame['value'][frame['key']] = value
        frame['state'] = 'comma'

    def scalar(self):
        token = ''.join(self.pieces)
        if token in ('NaN', 'Infinity', '-Infinity'): self.invalid()
        value = json.loads(token)
        self.pieces, self.mode = [], ''
        frame = self.stack[-1] if self.stack else None
        if frame and frame['state'] in ('key', 'keyOrEnd'):
            if not isinstance(value, str): self.invalid()
            frame['key'], frame['state'] = value, 'colon'
        else: self.value(value)

    def punctuation(self, char):
        frame = self.stack[-1] if self.stack else None
        if char in '{[':
            if len(self.stack) >= 64: self.invalid()
            value = {} if char == '{' else []
            self.value(value)
            self.stack.append({'value': value, 'state': 'keyOrEnd' if char == '{' else 'valueOrEnd'})
        elif char in '}]':
            if (not frame or isinstance(frame['value'], list) != (char == ']')
                    or frame['state'] not in ('comma', 'keyOrEnd' if char == '}' else 'valueOrEnd')): self.invalid()
            self.stack.pop()
        elif char == ':' and frame and frame['state'] == 'colon': frame['state'] = 'value'
        elif char == ',' and frame and frame['state'] == 'comma': frame['state'] = 'value' if isinstance(frame['value'], list) else 'key'
        else: self.invalid()

    def text(self, text):
        offset = 0
        while offset < len(text):
            if self.mode == 'string':
                if self.escaped:
                    self.pieces.append(text[offset]); offset += 1; self.escaped = False
                    continue
                match = STRING_BOUNDARY.search(text, offset)
                if not match:
                    self.pieces.append(text[offset:]); return
                self.pieces.append(text[offset:match.end()]); offset = match.end()
                if match.group() == '\\': self.escaped = True
                else: self.scalar()
            elif self.mode == 'bare':
                match = BARE_BOUNDARY.search(text, offset)
                if not match:
                    self.pieces.append(text[offset:]); return
                self.pieces.append(text[offset:match.start()]); offset = match.start(); self.scalar()
            else:
                char = text[offset]; offset += 1
                if char in ' \t\r\n': continue
                if char in '{}[],:': self.punctuation(char)
                elif char == '"': self.mode, self.pieces = 'string', ['"']
                else: self.mode, self.pieces = 'bare', [char]
