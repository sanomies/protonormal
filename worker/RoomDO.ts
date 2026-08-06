import { DurableObject } from 'cloudflare:workers'
import type { C2S, PeerInfo, S2C } from '../shared/protocol'
import { CLOSE_ROOM_FULL, MAX_NICK_LENGTH, MAX_PLAYERS } from '../shared/protocol'

// Per-connection identity. Lives in the WebSocket attachment so it survives
// hibernation and DO eviction — the DO itself keeps no state at all.
interface Attachment {
  id: string
  nick: string
}

// A dumb relay with a roster: fans out position updates, forwards WebRTC
// signaling between peers, and tells everyone who is in the room. One
// instance per room code (env.ROOMS.getByName(code)).
export class RoomDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Client keepalives are answered by the runtime without waking the DO.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  async fetch(request: Request): Promise<Response> {
    // The worker router already validated the room code, nick and Upgrade
    // header; re-derive the nick defensively anyway.
    const url = new URL(request.url)
    const nick = (url.searchParams.get('nick') ?? 'player').trim().slice(0, MAX_NICK_LENGTH)

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]

    // Rejecting the upgrade with an HTTP status would be invisible to the
    // browser WebSocket API, so accept (classic API — this socket must not
    // join the hibernation set), explain, and close with an app code.
    if (this.ctx.getWebSockets().length >= MAX_PLAYERS) {
      server.accept()
      this.send(server, {
        t: 'error',
        code: 'room-full',
        message: `This room already has ${MAX_PLAYERS} players.`,
      })
      server.close(CLOSE_ROOM_FULL, 'room-full')
      return new Response(null, { status: 101, webSocket: client })
    }

    const me: Attachment = { id: crypto.randomUUID(), nick }
    // Hibernation-capable accept (not server.accept()); the id tag lets
    // getWebSockets(id) find a peer's socket without scanning attachments.
    this.ctx.acceptWebSocket(server, [me.id])
    server.serializeAttachment(me)

    const peers: PeerInfo[] = []
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === server) continue
      const att = ws.deserializeAttachment() as Attachment | null
      if (att) peers.push(att)
    }
    this.send(server, { t: 'welcome', id: me.id, peers })
    this.broadcast({ t: 'peer-joined', peer: me }, server)

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return
    const me = ws.deserializeAttachment() as Attachment | null
    if (!me) return

    let msg: C2S
    try {
      msg = JSON.parse(raw) as C2S
    } catch {
      return
    }

    switch (msg.t) {
      case 'pos':
        this.broadcast({ t: 'pos', id: me.id, p: msg.p, ry: msg.ry }, ws)
        break
      case 'signal': {
        const target = this.ctx.getWebSockets(msg.to)[0]
        if (target) this.send(target, { t: 'signal', from: me.id, data: msg.data })
        break
      }
      case 'state':
        this.broadcast(
          { t: 'state', id: me.id, micMuted: msg.micMuted, instrumentOn: msg.instrumentOn },
          ws,
        )
        break
      case 'lamp':
        this.broadcast(
          { t: 'lamp', id: me.id, i: msg.i, p: msg.p, held: msg.held, on: msg.on },
          ws,
        )
        break
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.dropPeer(ws)
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.dropPeer(ws)
  }

  private dropPeer(ws: WebSocket): void {
    const me = ws.deserializeAttachment() as Attachment | null
    if (me) this.broadcast({ t: 'peer-left', id: me.id }, ws)
  }

  private send(ws: WebSocket, msg: S2C): void {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      // Peer is already gone; webSocketClose/Error will announce it.
    }
  }

  private broadcast(msg: S2C, except?: WebSocket): void {
    const raw = JSON.stringify(msg)
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue
      try {
        ws.send(raw)
      } catch {
        // Peer is already gone; webSocketClose/Error will announce it.
      }
    }
  }
}
