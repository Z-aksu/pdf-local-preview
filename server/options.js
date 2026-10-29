const DEFAULT_OPTIONS = Object.freeze({
  directory: '.',
  port: 3210,
  portSpecified: false,
  host: '0.0.0.0',
  open: true,
  help: false,
  version: false,
})

function readValue(args, index, optionName) {
  const value = args[index + 1]
  if (!value || value.startsWith('-')) {
    throw new Error(`缺少${optionName}参数值`)
  }
  return value
}

function parsePort(value) {
  const port = Number(value)
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('端口必须是 0 到 65535 之间的整数')
  }
  return port
}

export function parseCliOptions(args) {
  const options = { ...DEFAULT_OPTIONS }

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]

    if (argument === '--no-open') {
      options.open = false
    } else if (argument === '--lan') {
      options.host = '0.0.0.0'
    } else if (argument === '--help' || argument === '-h') {
      options.help = true
    } else if (argument === '--version' || argument === '-v') {
      options.version = true
    } else if (argument === '--dir' || argument === '-d') {
      options.directory = readValue(args, index, '目录')
      index += 1
    } else if (argument.startsWith('--dir=')) {
      const directory = argument.slice('--dir='.length)
      if (!directory) {
        throw new Error('缺少目录参数值')
      }
      options.directory = directory
    } else if (argument === '--port' || argument === '-p') {
      options.port = parsePort(readValue(args, index, '端口'))
      options.portSpecified = true
      index += 1
    } else if (argument.startsWith('--port=')) {
      options.port = parsePort(argument.slice('--port='.length))
      options.portSpecified = true
    } else if (argument === '--host') {
      options.host = readValue(args, index, '主机')
      index += 1
    } else if (argument.startsWith('--host=')) {
      const host = argument.slice('--host='.length)
      if (!host) {
        throw new Error('主机选项缺少参数值')
      }
      options.host = host
    } else {
      throw new Error(`未知参数：${argument}`)
    }
  }

  return options
}
