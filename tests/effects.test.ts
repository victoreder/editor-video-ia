// Efeitos do React nunca podem devolver nada além de uma função de limpeza. Um efeito
// escrito como expressão (`useEffect(() => algo(), …)`) repassa o retorno de `algo` —
// no Chrome novo, scrollIntoView devolve uma Promise e a tela quebrava ("i is not a function").
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const files = (dir: string): string[] =>
  fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));

test('nenhum useEffect com corpo em expressão', () => {
  const bad = files('src').flatMap((f) =>
    fs
      .readFileSync(f, 'utf8')
      .split('\n')
      .map((l, i) => ({l, i}))
      .filter(({l}) => /use(Layout)?Effect\(\s*(async\s*)?\(\)\s*=>\s*[^\s{]/.test(l))
      .map(({i}) => `${f}:${i + 1}`),
  );
  assert.deepEqual(bad, []);
});
