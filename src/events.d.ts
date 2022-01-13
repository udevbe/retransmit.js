export interface Event {
  target: any
  type: string
}

export interface ErrorEvent extends Event {
  error: Error
  message: string
  type: 'error'
}

export interface CloseEvent extends Event {
  code: number
  reason: string
  wasClean: boolean
}
export interface WebSocketEventMap {
  close: CloseEvent
  error: ErrorEvent
  message: MessageEvent
  open: Event
}

export interface WebSocketEventListenerMap {
  close: (event: CloseEvent) => void | { handleEvent: (event: CloseEvent) => void }
  error: (event: ErrorEvent) => void | { handleEvent: (event: ErrorEvent) => void }
  message: (event: MessageEvent) => void | { handleEvent: (event: MessageEvent) => void }
  open: (event: Event) => void | { handleEvent: (event: Event) => void }
}
