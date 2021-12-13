import Retransmitter from './index'
import ReconnectingWebsocket from 'reconnecting-websocket'

const MSG_INITIAL_SERIAL = 1
const MSG_DATA = 2
const MSG_ACK = 3

describe('retransmitter', () => {
  let myws: any
  let onReceiveCallback: any
  let retransmitter: any

  beforeEach(() => {
    const mockws = jest.fn().mockImplementation(() => {
      return {
        send: jest.fn(),
      }
    })

    myws = new mockws()
    myws.readyState = ReconnectingWebsocket.CLOSED

    myws.doOpen = () => {
      myws.readyState = ReconnectingWebsocket.OPEN
      myws.onopen(0)
    }

    myws.doClose = () => {
      myws.readyState = ReconnectingWebsocket.CLOSED
    }

    onReceiveCallback = jest.fn()
    retransmitter = new Retransmitter(myws, onReceiveCallback)
  })

  test('it does a correct handshake', () => {
    //given first time we connect
    // when we connect
    myws.doOpen()
    // then we get a proper handshake
    expect(myws.send).toHaveBeenCalledTimes(1)
    expect(myws.send).toBeCalledWith(new Uint32Array([MSG_INITIAL_SERIAL, 0]))
  })

  test('it can send data and a handshake', () => {
    //given first time we connect
    // when we connect
    myws.doOpen()
    // and send data
    retransmitter.send(new Uint8Array([5]))

    // then we get the encoded data sent out
    expect(myws.send).toHaveBeenCalledTimes(2)
    expect(myws.send).lastCalledWith(new Uint8Array([MSG_DATA, 0, 0, 0, 5]))
  })

  test('it can send data and a handshake when socket is not yet open', () => {
    retransmitter.send(new Uint8Array([5]))
    myws.doOpen()

    expect(myws.send).toHaveBeenCalledTimes(2)
    expect(myws.send).lastCalledWith(new Uint8Array([MSG_DATA, 0, 0, 0, 5]))
  })

  test('it can receive a handshake and receive data', () => {
    myws.doOpen()
    myws.onmessage({ data: new Uint32Array([MSG_INITIAL_SERIAL, 0]).buffer })
    myws.onmessage({ data: new Uint32Array([MSG_DATA, 5]).buffer })

    expect(onReceiveCallback).toHaveBeenCalledTimes(1)
    expect(onReceiveCallback).lastCalledWith(new Uint8Array(new Uint32Array([5]).buffer))
  })

  test('it retransmits unacknowledged data after disconnect', () => {
    myws.doOpen()
    retransmitter.send(new Uint8Array([5]))

    expect(myws.send).toHaveBeenCalledTimes(2)
    expect(myws.send).lastCalledWith(new Uint8Array([MSG_DATA, 0, 0, 0, 5]))
    myws.doClose()
    myws.doOpen()
    expect(myws.send).toHaveBeenCalledTimes(4)
    expect(myws.send).lastCalledWith(new Uint8Array([MSG_DATA, 0, 0, 0, 5]))
  })

  // it can ignore retransmits it has already seen
  test('it retransmits unacknowledged data after disconnect', () => {
    myws.doOpen()
    myws.onmessage({ data: new Uint32Array([MSG_INITIAL_SERIAL, 0]).buffer })
    myws.onmessage({ data: new Uint32Array([MSG_DATA, 5]).buffer })
    myws.onmessage({ data: new Uint32Array([MSG_DATA, 6]).buffer })
    myws.onmessage({ data: new Uint32Array([MSG_DATA, 7]).buffer })
    myws.onmessage({ data: new Uint32Array([MSG_DATA, 8]).buffer })

    expect(onReceiveCallback).toHaveBeenCalledTimes(4)
    expect(onReceiveCallback).lastCalledWith(new Uint8Array(new Uint32Array([8]).buffer))
    myws.doClose()
    myws.doOpen()
    myws.onmessage({ data: new Uint32Array([MSG_INITIAL_SERIAL, 0]).buffer })
    myws.onmessage({ data: new Uint32Array([MSG_DATA, 5]).buffer })
    myws.onmessage({ data: new Uint32Array([MSG_DATA, 6]).buffer })
    myws.onmessage({ data: new Uint32Array([MSG_DATA, 7]).buffer })
    myws.onmessage({ data: new Uint32Array([MSG_DATA, 8]).buffer })
    myws.onmessage({ data: new Uint32Array([MSG_DATA, 9]).buffer })
    expect(onReceiveCallback).toHaveBeenCalledTimes(5)
    expect(onReceiveCallback).lastCalledWith(new Uint8Array(new Uint32Array([9]).buffer))

    myws.doClose()
    myws.doOpen()
    myws.onmessage({ data: new Uint32Array([MSG_INITIAL_SERIAL, 2]).buffer })
    myws.onmessage({ data: new Uint32Array([MSG_DATA, 7]).buffer })
    myws.onmessage({ data: new Uint32Array([MSG_DATA, 8]).buffer })
    myws.onmessage({ data: new Uint32Array([MSG_DATA, 9]).buffer })
    myws.onmessage({ data: new Uint32Array([MSG_DATA, 10]).buffer })
    expect(onReceiveCallback).toHaveBeenCalledTimes(6)
    expect(onReceiveCallback).lastCalledWith(new Uint8Array(new Uint32Array([10]).buffer))
  })

  test('it drops messages from internal buffer if it received an acknowledge', () => {
    myws.doOpen()
    retransmitter.send(new Uint8Array([5]))
    retransmitter.send(new Uint8Array([6]))
    retransmitter.send(new Uint8Array([7]))

    expect(myws.send).toHaveBeenCalledTimes(4)
    expect(myws.send).lastCalledWith(new Uint8Array([MSG_DATA, 0, 0, 0, 7]))

    myws.onmessage({ data: new Uint32Array([MSG_ACK, 1]).buffer })
    myws.doClose()
    myws.doOpen()
    expect(myws.send).toHaveBeenCalledTimes(7)
    expect(myws.send).lastCalledWith(new Uint8Array([MSG_DATA, 0, 0, 0, 7]))

  })

  // it sends an acknowledgement after enough bytes are sent
  test('it sends an acknowledgement after enough bytes are sent', () => {
    myws.doOpen()
    myws.onmessage({ data: new Uint32Array([MSG_INITIAL_SERIAL, 0]).buffer })
    expect(myws.send).toHaveBeenCalledTimes(1) // just the serial

    const mylongmessage = new Uint8Array(20000) // more then 1/3th of the buffer, less then 1/2'th
    mylongmessage.set(new Uint8Array(new Uint32Array([MSG_DATA,1,2,3,4,5]).buffer),0)

    myws.onmessage({ data: mylongmessage.buffer })
    expect(myws.send).toHaveBeenCalledTimes(1) // still just the serial

    myws.onmessage({ data: mylongmessage.buffer })
    expect(myws.send).toHaveBeenCalledTimes(1) // still just the serial

    myws.onmessage({ data: mylongmessage.buffer })
    expect(myws.send).toHaveBeenCalledTimes(2) // serial + ACK
    expect(myws.send).lastCalledWith(new Uint32Array([MSG_ACK,  3]))

    myws.onmessage({ data: mylongmessage.buffer })
    expect(myws.send).toHaveBeenCalledTimes(2) // serial + only one ACK

  })
})
