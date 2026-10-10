// smoke: fake ctx with cordis-style strict proxy; tools must register via ctx.inject, apply must not throw
function strictProxy(obj) {
  return new Proxy(obj, {
    get(target, key) {
      if (key === 'inject' || key === 'effect' || key === 'logger' || key === 'getConfigPath') return target[key]
      throw new Error('cannot get property without inject: ' + String(key))
    },
  })
}
const registered = []
const fake = {
  logger: { info: (m) => console.log('[info]', m), warn: (m) => console.log('[warn]', m), error: (m) => console.log('[err]', m) },
  getConfigPath: () => 'C:/tmp/fake-profile',
  inject(deps, cb) { if (deps.includes('tools')) cb({ tools: { register: (t) => registered.push(t.name || t.id || 'unnamed') } }, 'sessionController') ; if (deps.includes('sessionController')) cb({ sessionController: undefined }) },
  effect(cb) { cb() },
}
const mod = await import('../dist/index.mjs')
mod.apply(strictProxy(fake), mod.DEFAULT_CONFIG)
await new Promise((r) => setTimeout(r, 300))
console.log('REGISTERED:', registered.join(','))
if (registered.length !== 5) { console.error('FAIL: expected 5 tools'); process.exit(1) }
console.log('SMOKE PASS')

