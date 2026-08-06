import { MAX_NICK_LENGTH, ROOM_CODE_RE } from '../shared/protocol'

export { RoomDO } from './RoomDO'

// Only /api/* reaches this Worker (assets.run_worker_first); everything else
// is served from the built SPA by the asset layer.
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)

    const match = /^\/api\/room\/([A-Za-z0-9]+)\/ws$/.exec(url.pathname)
    if (match) {
      const code = (match[1] ?? '').toUpperCase()
      if (!ROOM_CODE_RE.test(code)) {
        return Response.json({ error: 'bad room code' }, { status: 400 })
      }
      if (request.headers.get('Upgrade') !== 'websocket') {
        return Response.json({ error: 'expected websocket' }, { status: 426 })
      }
      const nick = (url.searchParams.get('nick') ?? '').trim()
      if (nick.length < 1 || nick.length > MAX_NICK_LENGTH) {
        return Response.json({ error: 'bad nick' }, { status: 400 })
      }
      return env.ROOMS.getByName(code).fetch(request)
    }

    return Response.json({ error: 'not found' }, { status: 404 })
  },
} satisfies ExportedHandler<Env>
