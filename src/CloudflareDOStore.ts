/* Copyright (c) 2024 Seneca contributors, MIT License */

import { Gubu } from 'gubu'

const { Open, Any, Skip } = Gubu

type Options = {
  debug: boolean
  map?: any
  prefix: string
  suffix: string
  generate_id?: (ent: any) => string
  cmd: {
    list: {
      size: number
      maxScan: number
    }
  }
  do: any
}

export type CloudflareDOStoreOptions = Partial<Options>

// Minimal subset of DurableObjectStorage this plugin needs.
type DOStorage = {
  get<T = any>(key: string): Promise<T | undefined>
  put<T = any>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list<T = any>(opts?: {
    prefix?: string
    limit?: number
    reverse?: boolean
    start?: string
    end?: string
  }): Promise<Map<string, T>>
}

function CloudflareDOStore(this: any, options: Options) {
  const seneca: any = this

  const init = seneca.export('entity/init')
  const generate_id: (ent: any) => string =
    options.generate_id || seneca.export('entity/generate_id')

  let desc: any = 'CloudflareDOStore'
  let storage: DOStorage

  let store = {
    name: 'CloudflareDOStore',

    save: function (this: any, msg: any, reply: any) {
      const ent = msg.ent
      const id = null == ent.id ? generate_id(ent) : ent.id
      const key = resolveKey(ent, id, options)
      const data = ent.data$(false)
      data.id = id

      storage
        .put(key, JSON.stringify(data))
        .then(() => {
          const ento = ent.make$().data$(data)
          reply(null, ento)
        })
        .catch((err: any) => reply(err))
    },

    load: function (this: any, msg: any, reply: any) {
      const qent = msg.qent
      const q = msg.q || {}

      if (null != q.id) {
        const key = resolveKey(qent, q.id, options)

        storage
          .get<string>(key)
          .then((raw) => {
            if (null == raw) return reply(null)
            const ento = qent.make$().data$(JSON.parse(raw))
            reply(null, ento)
          })
          .catch((err: any) => reply(err))
      } else {
        listEntities(qent, { ...q, limit$: 1 }, options, storage)
          .then((list) => reply(null, list[0] || null))
          .catch((err: any) => reply(err))
      }
    },

    list: function (this: any, msg: any, reply: any) {
      const qent = msg.qent
      const q = msg.q || {}

      listEntities(qent, q, options, storage)
        .then((list) => reply(null, list))
        .catch((err: any) => reply(err))
    },

    remove: function (this: any, msg: any, reply: any) {
      const ent = msg.ent || msg.qent
      const q = msg.q || {}

      if (null != q.id) {
        storage
          .delete(resolveKey(ent, q.id, options))
          .then(() => reply())
          .catch((err: any) => reply(err))
        return
      }

      const all = true === q.all$
      const limit$ = all ? options.cmd.list.maxScan : 1

      listEntities(ent, { ...q, limit$ }, options, storage)
        .then((list) =>
          Promise.all(
            list.map((item: any) =>
              storage.delete(resolveKey(ent, item.id, options)),
            ),
          ),
        )
        .then(() => reply())
        .catch((err: any) => reply(err))
    },

    close: function (this: any, _msg: any, reply: any) {
      this.log.debug('close', desc)
      reply()
    },

    native: function (this: any, _msg: any, reply: any) {
      reply(null, { storage: () => storage })
    },
  }

  let meta = init(seneca, options, store)

  desc = meta.desc

  seneca.add(
    { init: store.name, tag: meta.tag },
    function (this: any, _msg: any, reply: any) {
      storage = options.do?.storage
      reply()
    },
  )

  return {
    name: store.name,
    tag: meta.tag,
    exports: {
      native: () => ({ storage }),
    },
  }
}

function resolveKeyPrefix(ent: any, options: Options): string {
  const canonstr = ent.canon$({ string: true })

  const map = options.map || {}
  if (null != map[canonstr] && '' !== map[canonstr]) {
    return map[canonstr]
  }

  const prefix = options.prefix ? options.prefix + '/' : ''
  const suffix = options.suffix ? '/' + options.suffix : ''
  const infix = canonstr.replace(/-\//g, '')

  return prefix + infix + suffix
}

function resolveKey(ent: any, id: string, options: Options): string {
  return resolveKeyPrefix(ent, options) + '/' + id
}

async function listEntities(
  ent: any,
  q: any,
  options: Options,
  storage: DOStorage,
): Promise<any[]> {
  const prefix = resolveKeyPrefix(ent, options) + '/'
  const maxScan = options.cmd.list.maxScan

  const map = await storage.list<string>({ prefix, limit: maxScan })

  let list: any[] = []
  for (const raw of map.values()) {
    const data = JSON.parse(raw)
    list.push(data)
  }

  for (const field of Object.keys(q)) {
    if (field.endsWith('$')) continue
    list = list.filter((item) => item[field] === q[field])
  }

  if (q.sort$) {
    const [field, dir] = Object.entries(q.sort$)[0]
    list = list.slice().sort((a, b) => {
      if (a[field] === b[field]) return 0
      const order = a[field] < b[field] ? -1 : 1
      return (dir as number) < 0 ? -order : order
    })
  }

  const skip = q.skip$ || 0
  const limit = null == q.limit$ ? options.cmd.list.size : q.limit$
  list = list.slice(skip, skip + limit)

  if (Array.isArray(q.fields$)) {
    list = list.map((item) => {
      const picked: any = { id: item.id }
      for (const f of q.fields$) picked[f] = item[f]
      return picked
    })
  }

  return list.map((data) => ent.make$().data$(data))
}

const defaults: Options = {
  debug: false,
  map: Any(),
  prefix: '',
  suffix: '',

  cmd: {
    list: {
      size: 11,
      maxScan: 1000,
    },
  },

  do: Open({
    storage: Skip(Any()),
  }),
}

Object.assign(CloudflareDOStore, {
  defaults,
  utils: { resolveKeyPrefix, resolveKey },
})

export default CloudflareDOStore

if ('undefined' !== typeof module) {
  module.exports = CloudflareDOStore
}
