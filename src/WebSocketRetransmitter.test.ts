import ReconnectingWebsocket from 'reconnecting-websocket'
import { WebSocketRetransmitter, RETRANSMIT_MSG_TYPE } from './WebSocketRetransmitter'

describe('WebSocketRetransmitter', () => {
  let mockWebSocket: ReconnectingWebsocket
  let onReceiveCallback: jest.Mock
  let retransmitter: WebSocketRetransmitter

  function openWebSocket() {
    mockWebSocket.readyState = ReconnectingWebsocket.OPEN
    mockWebSocket.onopen(undefined)
  }

  function closeWebSocket() {
    mockWebSocket.readyState = ReconnectingWebsocket.CLOSED
  }

  beforeEach(() => {
    const MockReconnectingWebSocket = jest.fn().mockImplementation(() => ({
      send: jest.fn(),
      readyState: ReconnectingWebsocket.CLOSED,
    }))

    mockWebSocket = new MockReconnectingWebSocket()

    onReceiveCallback = jest.fn()
    retransmitter = new WebSocketRetransmitter(mockWebSocket, onReceiveCallback)
  })

  test('it sends a handshake after the websocket is opened', () => {
    // given a closed websocket

    // when websocket connection is opened
    openWebSocket()

    // then websocket receives a handshake
    expect(mockWebSocket.send).toHaveBeenCalledTimes(1)
    expect(mockWebSocket.send).toBeCalledWith(new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, 0]))
  })

  test('it sends a handshake and data after the websocket is opened', () => {
    // given a closed websocket

    // when the websocket is opened and data is sent
    openWebSocket()
    retransmitter.send(new Uint8Array([5]))

    // then we get the encoded data sent out
    expect(mockWebSocket.send).toHaveBeenCalledTimes(2)
    expect(mockWebSocket.send).lastCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA, 0, 0, 0, 5]))
  })

  test('it sends a handshake and previously buffered data after the websocket is opened', () => {
    // given a closed websocket

    // when data is sent before websocket is opened
    retransmitter.send(new Uint8Array([5]))
    openWebSocket()

    // then a handshake and buffered data is sent
    expect(mockWebSocket.send).toHaveBeenCalledTimes(2)
    expect(mockWebSocket.send).lastCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA, 0, 0, 0, 5]))
  })

  test('it receives a handshake and data after the websocket is opened', () => {
    // given a closed websocket

    //when websocket is opened and data is received
    openWebSocket()
    mockWebSocket.onmessage({ data: new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, 0]).buffer } as MessageEvent)
    mockWebSocket.onmessage({ data: new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 5]).buffer } as MessageEvent)

    // then a handshake and data is received
    expect(onReceiveCallback).toHaveBeenCalledTimes(1)
    expect(onReceiveCallback).lastCalledWith(new Uint8Array(new Uint32Array([5]).buffer))
  })

  test('it retransmits unacknowledged data after disconnect', () => {
    // given a closed websocket

    // when websocket is opened and data is sent
    openWebSocket()
    retransmitter.send(new Uint8Array([5]))

    // then a handshake and data is sent over websocket
    expect(mockWebSocket.send).toHaveBeenCalledTimes(2)
    expect(mockWebSocket.send).lastCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA, 0, 0, 0, 5]))

    // and when the websocket is reconnected
    closeWebSocket()
    openWebSocket()

    // then a new handshake and the previously un-acked data is sent again
    expect(mockWebSocket.send).toHaveBeenCalledTimes(4)
    expect(mockWebSocket.send).lastCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA, 0, 0, 0, 5]))
  })

  // it can ignore retransmits it has already seen
  test('it receives unacknowledged data after disconnect', () => {
    // given a closed websocket

    // when websocket is opened and a serial and data is received
    openWebSocket()
    mockWebSocket.onmessage({ data: new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, 0]).buffer } as MessageEvent)
    mockWebSocket.onmessage({ data: new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 5]).buffer } as MessageEvent)
    mockWebSocket.onmessage({ data: new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 6]).buffer } as MessageEvent)
    mockWebSocket.onmessage({ data: new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 7]).buffer } as MessageEvent)
    mockWebSocket.onmessage({ data: new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 8]).buffer } as MessageEvent)

    // then the callback returns only the data corresponding to the received the serial
    expect(onReceiveCallback).toHaveBeenCalledTimes(4)
    expect(onReceiveCallback).lastCalledWith(new Uint8Array(new Uint32Array([8]).buffer))

    // and when websocket is reconnected and a new serial and old and new data is received
    closeWebSocket()
    openWebSocket()
    mockWebSocket.onmessage({ data: new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, 0]).buffer } as MessageEvent)
    mockWebSocket.onmessage({ data: new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 5]).buffer } as MessageEvent)
    mockWebSocket.onmessage({ data: new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 6]).buffer } as MessageEvent)
    mockWebSocket.onmessage({ data: new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 7]).buffer } as MessageEvent)
    mockWebSocket.onmessage({ data: new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 8]).buffer } as MessageEvent)
    mockWebSocket.onmessage({ data: new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 9]).buffer } as MessageEvent)

    // then the callback returns only the data corresponding to the newly received serial
    expect(onReceiveCallback).toHaveBeenCalledTimes(5)
    expect(onReceiveCallback).lastCalledWith(new Uint8Array(new Uint32Array([9]).buffer))

    // and when websocket is reconnected and a new serial and old and new data is received
    closeWebSocket()
    openWebSocket()
    mockWebSocket.onmessage({ data: new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, 2]).buffer } as MessageEvent)
    mockWebSocket.onmessage({ data: new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 7]).buffer } as MessageEvent)
    mockWebSocket.onmessage({ data: new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 8]).buffer } as MessageEvent)
    mockWebSocket.onmessage({ data: new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 9]).buffer } as MessageEvent)
    mockWebSocket.onmessage({ data: new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 10]).buffer } as MessageEvent)

    // then the callback returns only the data corresponding to the newly received serial
    expect(onReceiveCallback).toHaveBeenCalledTimes(6)
    expect(onReceiveCallback).lastCalledWith(new Uint8Array(new Uint32Array([10]).buffer))
  })

  test('it drops messages from internal buffer if it received an acknowledge', () => {
    // given a closed websocket

    // when websocket is opened and data is sent
    openWebSocket()
    retransmitter.send(new Uint8Array([5]))
    retransmitter.send(new Uint8Array([6]))
    retransmitter.send(new Uint8Array([7]))

    // then a handshake and data is sent over websocket
    expect(mockWebSocket.send).toHaveBeenCalledTimes(4)
    expect(mockWebSocket.send).lastCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA, 0, 0, 0, 7]))

    // and when an acknowledgment is received and connection is reset
    mockWebSocket.onmessage({ data: new Uint32Array([RETRANSMIT_MSG_TYPE.ACK, 1]).buffer } as MessageEvent)
    closeWebSocket()
    openWebSocket()

    // then only unacknowledged data is sent again
    expect(mockWebSocket.send).toHaveBeenCalledTimes(7)
    expect(mockWebSocket.send).lastCalledWith(new Uint8Array([RETRANSMIT_MSG_TYPE.DATA, 0, 0, 0, 7]))
  })

  // it sends an acknowledgement after enough bytes are sent
  test('it sends an acknowledgement after enough bytes are sent', () => {
    // given a closed websocket

    // when websocket is opened and serial is received
    openWebSocket()
    mockWebSocket.onmessage({ data: new Uint32Array([RETRANSMIT_MSG_TYPE.INITIAL_SERIAL, 0]).buffer } as MessageEvent)

    // then only our own serial is sent
    expect(mockWebSocket.send).toHaveBeenCalledTimes(1) // just the serial

    // and when cumulative received message size threshold is crossed
    const mylongmessage = new Uint8Array(20000) // more then 1/3th of the buffer, less then 1/2'th
    mylongmessage.set(new Uint8Array(new Uint32Array([RETRANSMIT_MSG_TYPE.DATA, 1, 2, 3, 4, 5]).buffer), 0)

    mockWebSocket.onmessage({ data: mylongmessage.buffer } as MessageEvent)
    expect(mockWebSocket.send).toHaveBeenCalledTimes(1) // still just the serial
    mockWebSocket.onmessage({ data: mylongmessage.buffer } as MessageEvent)
    expect(mockWebSocket.send).toHaveBeenCalledTimes(1) // still just the serial
    mockWebSocket.onmessage({ data: mylongmessage.buffer } as MessageEvent)

    // then a single ack is sent
    expect(mockWebSocket.send).toHaveBeenCalledTimes(2) // serial + ACK
    expect(mockWebSocket.send).lastCalledWith(new Uint32Array([RETRANSMIT_MSG_TYPE.ACK, 3]))
    mockWebSocket.onmessage({ data: mylongmessage.buffer } as MessageEvent)
    expect(mockWebSocket.send).toHaveBeenCalledTimes(2) // serial + only one ACK
  })
})
