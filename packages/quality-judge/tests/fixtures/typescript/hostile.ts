declare const exec: (command: string) => void;

export function dangerous(command: string, input: string): unknown {
  const result = eval(input);
  exec(`${command} ${input}`);
  try {
    return result;
  } catch {}
}
