export interface EventLike {
  target: any
  type: 'open' | 'close' | 'error' | 'message'
}

export interface ErrorEventLike extends EventLike {
  error: Error
  message: string
  type: 'error'
}

export interface CloseEventLike extends EventLike {
  type: 'close'
  code: number
  reason: string
  wasClean: boolean
}

export interface MessageEventLike extends EventLike {
  type: 'message'
  readonly data: string | ArrayBuffer
}

interface RetransmittingWebSocketEventMap {
  close: CloseEventLike
  error: EventLike
  message: MessageEventLike
  open: EventLike
}

export interface WebSocketEventListenerMap {
  close: (event: CloseEventLike) => void
  error: (event: ErrorEventLike) => void
  message: (event: MessageEventLike) => void
  open: (event: EventLike) => void
}
