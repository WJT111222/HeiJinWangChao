const maxDepth = 64;
type MacroName = 'setvar' | 'getvar' | 'random' | 'user' | 'char';
type Template = Array<string | { name: MacroName; args: Template[] }>;
const arity = { setvar: 2, getvar: 1, random: undefined, user: 0, char: 0 };

/** Static template shared by the writing witness and the renderer. Values from the game are never reparsed. */
export function parsePresetTemplate(source: string, unknown?: Set<string>): Template {
  let pos = 0;
  function read(stopAtArgument: boolean, depth: number): Template {
    if (depth > maxDepth) throw new Error('预设宏嵌套过深');
    const parts: Template = [];
    let literal = '';
    while (pos < source.length) {
      if (stopAtArgument && (source.startsWith('::', pos) || source.startsWith('}}', pos))) break;
      if (source[pos] === '\\' && '{}:\\'.includes(source[pos + 1] ?? ' ')) {
        literal += source[pos + 1];
        pos += 2;
        continue;
      }
      if (!source.startsWith('{{', pos)) {
        literal += source[pos++];
        continue;
      }
      const start = pos;
      const head = /^\{\{\s*(\/\/|[\w-]+)\s*/.exec(source.slice(pos));
      const key = head?.[1].toLowerCase();
      if (!head || !key || !Object.hasOwn(arity, key)) {
        const comment = key === '//';
        let level = 1;
        pos += 2;
        while (level && pos < source.length) {
          if (source[pos] === '\\') pos += 2;
          else if (source.startsWith('{{', pos)) {
            level++;
            if (comment && depth + level - 1 > maxDepth) throw new Error('预设宏嵌套过深');
            pos += 2;
          } else if (source.startsWith('}}', pos)) {
            level--;
            pos += 2;
          } else pos++;
        }
        if (comment) {
          if (level) throw new Error('预设宏未闭合或参数无效：//');
        } else {
          unknown?.add(head?.[1] ?? '(未知语法)');
          literal += source.slice(start, pos);
        }
        continue;
      }
      const name = key as MacroName;
      pos += head[0].length;
      const args: Template[] = [];
      if (name === 'random' && !source.startsWith('::', pos) && !source.startsWith('}}', pos)) {
        if (source[pos] === ':') pos++;
        args.push(read(true, depth + 1));
      }
      while (source.startsWith('::', pos)) {
        pos += 2;
        args.push(read(true, depth + 1));
      }
      if (!source.startsWith('}}', pos)) throw new Error('预设宏未闭合或参数无效：' + name);
      pos += 2;
      if (arity[name] !== undefined && args.length !== arity[name]) throw new Error('预设宏参数无效：' + name);
      if (literal) parts.push(literal);
      literal = '';
      parts.push({ name, args });
    }
    if (literal) parts.push(literal);
    return parts;
  }
  return read(false, 0);
}

/** Each assembly owns its variable table and evaluates random choices exactly once in source order. */
export function presetMacros(user: string, char: string, random: () => number = Math.random) {
  const vars = new Map<string, string>(), unknown = new Set<string>();
  function render(parts: Template): string {
    return parts.map(part => {
      if (typeof part === 'string') return part;
      const args = part.args.map(render);
      switch (part.name) {
        case 'setvar': vars.set(args[0].trim(), args[1]); return '';
        case 'getvar': return vars.get(args[0].trim()) ?? '';
        case 'user': return user;
        case 'char': return char;
        case 'random': {
          const values = args.length === 1 ? args[0].split(/(?<!\\),/).map(v => v.replace(/\\,/g, ',')) : args;
          return values.length ? values[Math.floor(random() * values.length)].trim() : '';
        }
      }
    }).join('');
  }
  return { expand: (source: string) => render(parsePresetTemplate(source, unknown)), unknown };
}
