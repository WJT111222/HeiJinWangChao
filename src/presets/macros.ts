const maxDepth = 64;

/** 每次组装使用一个实例；游戏资料作为值插入，不再次解释为模板。 */
export function presetMacros(user: string, char: string, random: () => number = Math.random) {
  const vars = new Map<string, string>(),
    unknown = new Set<string>();
  function expand(source: string): string {
    let pos = 0;
    function read(stopAtArgument: boolean, depth: number): string {
      if (depth > maxDepth) throw new Error('预设宏嵌套过深');
      let out = '';
      while (pos < source.length) {
        if (stopAtArgument && (source.startsWith('::', pos) || source.startsWith('}}', pos))) break;
        const escaped = source[pos] === '\\' && '{}:\\'.includes(source[pos + 1] ?? ' ');
        if (escaped) {
          out += source[pos + 1];
          pos += 2;
          continue;
        }
        if (!source.startsWith('{{', pos)) {
          out += source[pos++];
          continue;
        }
        const start = pos;
        const head = /^\{\{\s*(\/\/|[\w-]+)\s*/.exec(source.slice(pos));
        const name = head?.[1].toLowerCase();
        const comment = name === '//';
        if (comment || !head || !name || !['setvar', 'getvar', 'random', 'user', 'char'].includes(name)) {
          // Balance the whole span without expanding macros inside comments or unknown syntax.
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
            unknown.add(head?.[1] ?? '(未知语法)');
            out += source.slice(start, pos);
          }
          continue;
        }
        pos += head[0].length;
        const args: string[] = [];
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
        if (name === 'setvar' && args.length === 2) vars.set(args[0].trim(), args[1]);
        else if (name === 'getvar' && args.length === 1) out += vars.get(args[0].trim()) ?? '';
        else if (name === 'user' && !args.length) out += user;
        else if (name === 'char' && !args.length) out += char;
        else if (name === 'random') {
          const values =
            args.length === 1 ? args[0].split(/(?<!\\),/).map((v) => v.replace(/\\,/g, ',')) : args;
          if (values.length) out += values[Math.floor(random() * values.length)].trim();
        } else throw new Error('预设宏参数无效：' + name);
      }
      return out;
    }
    return read(false, 0);
  }
  return { expand, unknown };
}
