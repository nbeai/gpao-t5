function posixQuote(value) { return `'${String(value).replaceAll("'", `'\"'\"'`)}'`; }

export function commandWithManagedPath(command, path, family) {
  if (!path || family !== 'posix') return command;
  return `export PATH=${posixQuote(path)}:"$PATH"\n${command}`;
}
