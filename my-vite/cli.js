#!/usr/bin/env node

const path = require('path')
const { Readable } = require('stream')
const Koa = require('koa')
const send = require('koa-send')
const replace = require('stream-replace')
const compilerSfc = require('@vue/compiler-sfc')

const streamToString = stream => new Promise((resolve, reject) => {
  const chunks = []
  stream.on('data', chunk => chunks.push(chunk))
  stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  stream.on('error', reject)
})

const cwd = process.cwd()

const app = new Koa()

// /@modules request
app.use(async (ctx, next) => {
  if (ctx.path.startsWith('/@modules/')) {
    const moduleName = ctx.path.substr(10)
    const moduleDir = path.join(cwd, 'node_modules', moduleName)
    const modulePkg = require(path.join(moduleDir, 'package.json'))
    ctx.path = path.join('/node_modules', moduleName, modulePkg.module)
  }
  await next()
})

// static files serve
app.use(async (ctx, next) => {
  await send(ctx, ctx.path, { root: cwd, index: 'index.html' })
  await next()
})

// static file import
app.use(async (ctx, next) => {
  if (ctx.query.import !== undefined) {
    if (ctx.type.startsWith('image')) {
      ctx.type = 'application/javascript'
      ctx.body = Readable.from(`export default '${ctx.path}'`)
    } else if (ctx.type === 'text/css') {
      const css = await streamToString(ctx.body)
      ctx.type = 'application/javascript'
      ctx.body = Readable.from(`const style = document.createElement('style')
      style.innerHTML = ${JSON.stringify(css)}
      document.head.appendChild(style)`)
    }
  }
  await next()
})

// sfc compile
app.use(async (ctx, next) => {
  if (ctx.path.endsWith('.vue')) {
    const contents = await streamToString(ctx.body)
    const { descriptor } = compilerSfc.parse(contents)

    let code = ''
    if (!ctx.query.type) {
      const optionsCode = descriptor.script.content.replace(
        /export\s+default\s+/, 
        `const ___options = `
      )
      code = `${optionsCode}
  import { render as ___render } from '${ctx.path}?type=template'
  ___options.render = ___render
  export default ___options`
    } else if (ctx.query.type === 'template') {
      const templateRender = compilerSfc.compileTemplate({ source: descriptor.template.content })
      code = templateRender.code
    }

    ctx.type = 'application/javascript'
    ctx.body = Readable.from(code)
  }
  await next()
})

// replace javascript import
app.use(async (ctx, next) => {
  if (ctx.type === 'text/html' || ctx.type === 'application/javascript') {
    ctx.body = ctx.body
      // .pipe(replace(/((import|export)\s[^'"]*['"])(?![\.\/])/g, '$1/@modules/'))
      .pipe(replace(/from\s(['"])(?![\.\/])/g, 'from $1/@modules/'))
      // .pipe(replace(/(import\s*[^'"]*['"][^'"]+(png|jpe?g|gif|css))/g, '$1?import'))
      .pipe(replace(/from\s(['"].+?)\.(png|jpe?g|gif)/g, 'from $1.$2?import'))
      .pipe(replace(/import\s(['"].+?)\.(css)/g, 'import $1.$2?import'))
      .pipe(replace(/process\.env\.NODE_ENV/g, '"production"'))
  }
  await next()
})

app.listen(3000)

console.log('Server running @ http://localhost:3000')