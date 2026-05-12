import React, { useEffect, useMemo, useRef, useState } from 'react'
import io from 'socket.io-client'

const SERVER = import.meta.env.VITE_SERVER_URL || (window.location.hostname === 'localhost' ? 'http://localhost:4000' : window.location.origin)
const STUN_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]

function loadStoredAuth() {
  try {
    const raw = localStorage.getItem('discord-voice-auth')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveStoredAuth(auth) {
  if (!auth) {
    localStorage.removeItem('discord-voice-auth')
    return
  }
  localStorage.setItem('discord-voice-auth', JSON.stringify(auth))
}

function routeFromPath(pathname) {
  const match = pathname.match(/^\/invite\/([A-Za-z0-9-]+)/)
  if (match) return { kind: 'invite', token: match[1] }
  return { kind: 'home' }
}

function formatExpiry(expiresAt) {
  if (!expiresAt) return 'Permanent invite'
  return `Expires ${new Date(expiresAt).toLocaleString()}`
}

function makeAvatarColor(seed) {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 360
  return `hsl(${hash} 72% 55%)`
}

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'U'
}

function Icon({ name, size = 20, strokeWidth = 2.25, className = '' }) {
  const icons = {
    menu: 'M4 6h16M4 12h16M4 18h16',
    home: 'M3 11.5 12 4l9 7.5M6.5 10.5V20h11V10.5',
    plus: 'M12 5v14M5 12h14',
    mic: 'M12 14c2.2 0 4-1.8 4-4V7a4 4 0 0 0-8 0v3c0 2.2 1.8 4 4 4Zm-5 0c0 2.8 2.2 5 5 5s5-2.2 5-5M12 19v3',
    headphones: 'M4 15v-3a8 8 0 0 1 16 0v3M5 14a2 2 0 0 1 2-2h1v6H7a2 2 0 0 1-2-2v-2Zm10 4v-6h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1Z',
    share: 'M15 8a3 3 0 1 0-2.8-4H12M9 13l6-3m0 4-6-3M8 15.5A3 3 0 1 0 6.2 21H6',
    link: 'M10 14a4 4 0 0 1 0-5.7l2.3-2.3a4 4 0 0 1 5.7 5.7L17 13m-3 3-2.3 2.3a4 4 0 0 1-5.7-5.7L7 11',
    copy: 'M9 9h10v10H9zM5 5h10v10H5z',
    leave: 'M10 17l5-5-5-5M15 12H3m13-7h3v14h-3',
    lock: 'M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z',
    search: 'M10.5 18a7.5 7.5 0 1 1 0-15a7.5 7.5 0 0 1 0 15Zm5.1-2.4 4.3 4.3',
    settings: 'M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7Zm8 3.5-2.1.7a6.6 6.6 0 0 1-.5 1.1l1 2-1.8 1.8-2-1a6.6 6.6 0 0 1-1.1.5L12 20h-2l-.7-2.1a6.6 6.6 0 0 1-1.1-.5l-2 1L4.4 16.6l1-2a6.6 6.6 0 0 1-.5-1.1L2.8 12l.7-2.1 2.1-.5a6.6 6.6 0 0 1 .5-1.1l-1-2L6.9 4.5l2 1a6.6 6.6 0 0 1 1.1-.5L10 3h2l.7 2.1c.4.1.8.3 1.1.5l2-1 1.8 1.8-1 2c.2.3.4.7.5 1.1L20 12Z',
    spark: 'M12 2.5l1.8 6.2L20 10.5l-6.2 1.8L12 18.5l-1.8-6.2L4 10.5l6.2-1.8L12 2.5Z',
    chevron: 'M8 6l8 6-8 6',
  }

  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={icons[name]} />
    </svg>
  )
}

function Divider() {
  return <div className="divider" />
}

function ChannelItem({ active, name, count, onClick }) {
  return (
    <button className={`channel-item ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="channel-leading"><Icon name="home" size={16} /></span>
      <span className="channel-name">{name}</span>
      <span className="channel-count">{count}</span>
    </button>
  )
}

function ParticipantCard({ participant, speaking, isSelf }) {
  return (
    <div className={`participant-card ${speaking ? 'speaking' : ''} ${isSelf ? 'self' : ''}`}>
      <div className="avatar" style={{ background: participant.avatarColor }}>
        {initials(participant.username)}
      </div>
      <div className="participant-meta">
        <div className="participant-name">
          {participant.username}
          {isSelf ? ' (you)' : ''}
        </div>
        <div className="participant-status">{speaking ? 'Speaking' : participant.self ? 'Ready' : 'Connected'}</div>
      </div>
      <div className={`pulse ${speaking ? 'on' : ''}`} />
    </div>
  )
}

function AuthPanel({ value, onChange, onSubmit, onGuest, busy, error }) {
  return (
    <div className="auth-panel card">
      <div className="panel-title">Sign in or continue as guest</div>
      <div className="tabs">
        {['guest', 'login', 'register'].map(mode => (
          <button key={mode} className={value.mode === mode ? 'active' : ''} onClick={() => onChange({ ...value, mode })}>
            {mode}
          </button>
        ))}
      </div>
      <label>
        Username
        <input value={value.username} onChange={e => onChange({ ...value, username: e.target.value })} placeholder="alex" />
      </label>
      {value.mode !== 'guest' ? (
        <label>
          Password
          <input type="password" value={value.password} onChange={e => onChange({ ...value, password: e.target.value })} placeholder="••••••••" />
        </label>
      ) : null}
      <div className="actions-row">
        {value.mode === 'guest' ? (
          <button className="primary" onClick={onGuest} disabled={busy}>Continue as guest</button>
        ) : (
          <button className="primary" onClick={onSubmit} disabled={busy}>
            {value.mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        )}
      </div>
      {error ? <div className="error">{error}</div> : null}
    </div>
  )
}

export default function App() {
  const [route, setRoute] = useState(() => routeFromPath(window.location.pathname))
  const [auth, setAuth] = useState(() => loadStoredAuth())
  const [authForm, setAuthForm] = useState(() => ({
    mode: auth ? 'login' : 'guest',
    username: auth?.user?.username || '',
    password: '',
  }))
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [rooms, setRooms] = useState([])
  const [currentRoom, setCurrentRoom] = useState(null)
  const [participants, setParticipants] = useState([])
  const [inviteData, setInviteData] = useState(null)
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteMessage, setInviteMessage] = useState('')
  const [roomName, setRoomName] = useState('Gaming')
  const [roomCapacity, setRoomCapacity] = useState(10)
  const [joinError, setJoinError] = useState('')
  const [socketStatus, setSocketStatus] = useState('connecting')
  const [muted, setMuted] = useState(false)
  const [deafened, setDeafened] = useState(false)
  const [speaking, setSpeaking] = useState({})
  const [remoteStreams, setRemoteStreams] = useState({})
  const [selfAvatarColor, setSelfAvatarColor] = useState(() => makeAvatarColor(auth?.user?.username || 'guest'))
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)

  const socketRef = useRef(null)
  const localStreamRef = useRef(null)
  const peerConnectionsRef = useRef({})
  const meterCleanupsRef = useRef({})
  const audioContextRef = useRef(null)
  const currentRoomRef = useRef(null)
  const authRef = useRef(auth)

  const user = auth?.user || { username: 'Guest', guest: true }
  const activeRoomMembers = useMemo(() => {
    if (!currentRoom) return []
    return [
      { socketId: 'self', username: user.username, avatarColor: selfAvatarColor, self: true },
      ...participants,
    ]
  }, [currentRoom, participants, selfAvatarColor, user.username])

  const roomStats = useMemo(() => {
    const total = rooms.length
    const active = rooms.reduce((sum, room) => sum + (room.count || 0), 0)
    return { total, active }
  }, [rooms])

  function refreshRooms() {
    fetch(`${SERVER}/rooms`)
      .then(res => res.json())
      .then(setRooms)
      .catch(() => setRooms([]))
  }

  function navigate(path) {
    window.history.pushState({}, '', path)
    setRoute(routeFromPath(path))
  }

  function closeInviteToast() {
    setInviteCopied(false)
  }

  useEffect(() => {
    const onPopState = () => setRoute(routeFromPath(window.location.pathname))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    refreshRooms()
  }, [])

  useEffect(() => {
    setSelfAvatarColor(makeAvatarColor(user.username || 'guest'))
  }, [user.username])

  useEffect(() => {
    currentRoomRef.current = currentRoom
  }, [currentRoom])

  useEffect(() => {
    authRef.current = auth
  }, [auth])

  useEffect(() => {
    const socket = io(SERVER, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelayMax: 5000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setSocketStatus('connected')
      identifySocket(socket)
    })

    socket.on('disconnect', () => {
      setSocketStatus('disconnected')
    })

    socket.on('room-update', ({ roomId, participants: peerList, count, capacity }) => {
      setRooms(prev => prev.map(room => (room.id === roomId ? { ...room, count, capacity: capacity || room.capacity } : room)))
      if (currentRoomRef.current && currentRoomRef.current.id === roomId) {
        setParticipants(peerList)
      }
    })

    socket.on('room-joined', async ({ room, participants: peerList }) => {
      setCurrentRoom(room)
      currentRoomRef.current = room
      setParticipants(peerList)
      setJoinError('')
      const stream = await ensureLocalStream()
      if (!stream) return
      for (const peer of peerList) {
        await connectToPeer(peer.socketId, true)
      }
    })

    socket.on('peer-joined', async ({ socketId, username: peerName, avatarColor }) => {
      if (!currentRoomRef.current) return
      setParticipants(prev => {
        if (prev.some(peer => peer.socketId === socketId)) return prev
        return [...prev, { socketId, username: peerName, avatarColor }]
      })
      if (localStreamRef.current) {
        await connectToPeer(socketId, false)
      }
    })

    socket.on('peer-left', ({ socketId }) => {
      cleanupPeer(socketId)
      setParticipants(prev => prev.filter(peer => peer.socketId !== socketId))
      setSpeaking(prev => {
        const next = { ...prev }
        delete next[socketId]
        return next
      })
      setRemoteStreams(prev => {
        const next = { ...prev }
        delete next[socketId]
        return next
      })
    })

    socket.on('room-full', () => {
      setJoinError('That room is full.')
    })

    socket.on('signal', async ({ from, data }) => {
      if (!localStreamRef.current) return
      const pc = await ensurePeerConnection(from)
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp)
        if (data.sdp.type === 'offer') {
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          socket.emit('signal', { to: from, data: { sdp: pc.localDescription } })
        }
        return
      }
      if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate)
        } catch {
          // ignore candidate races
        }
      }
    })

    socket.on('connect_error', () => setSocketStatus('error'))

    return () => {
      socket.close()
    }
  }, [])

  useEffect(() => {
    if (socketRef.current?.connected) identifySocket(socketRef.current)
  }, [auth])

  useEffect(() => {
    let cancelled = false
    if (route.kind !== 'invite') {
      setInviteData(null)
      return () => {}
    }

    fetch(`${SERVER}/invite/${route.token}`)
      .then(async res => {
        if (!res.ok) throw new Error('invite not found')
        return res.json()
      })
      .then(data => {
        if (!cancelled) setInviteData(data)
      })
      .catch(() => {
        if (!cancelled) setInviteData({ error: 'Invite not found or expired.' })
      })

    return () => {
      cancelled = true
    }
  }, [route])

  function identifySocket(socket) {
    if (!socket) return
    if (auth?.token) {
      socket.emit('auth:identify', { token: auth.token })
      return
    }
    socket.emit('auth:identify', { username: user.username })
  }

  async function ensureLocalStream() {
    if (localStreamRef.current) return localStreamRef.current
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      localStreamRef.current = stream
      startVoiceMeter(stream, 'self')
      const audioTrack = stream.getAudioTracks()[0]
      if (audioTrack) audioTrack.enabled = !muted
      return stream
    } catch {
      setJoinError('Microphone access is required to join a room.')
      return null
    }
  }

  function startVoiceMeter(stream, key) {
    stopVoiceMeter(key)
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext
    if (!AudioContextCtor) return
    if (!audioContextRef.current) audioContextRef.current = new AudioContextCtor()
    const context = audioContextRef.current
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)
    let raf = 0

    const tick = () => {
      analyser.getByteFrequencyData(data)
      const peak = data.reduce((max, value) => Math.max(max, value), 0)
      setSpeaking(prev => ({ ...prev, [key]: peak > 24 }))
      raf = window.requestAnimationFrame(tick)
    }

    tick()
    meterCleanupsRef.current[key] = () => {
      window.cancelAnimationFrame(raf)
      source.disconnect()
      analyser.disconnect()
    }
  }

  function stopVoiceMeter(key) {
    if (meterCleanupsRef.current[key]) {
      meterCleanupsRef.current[key]()
      delete meterCleanupsRef.current[key]
    }
  }

  function cleanupPeer(peerId) {
    stopVoiceMeter(peerId)
    const pc = peerConnectionsRef.current[peerId]
    if (pc) {
      pc.ontrack = null
      pc.onicecandidate = null
      pc.close()
      delete peerConnectionsRef.current[peerId]
    }
  }

  async function ensurePeerConnection(peerId) {
    const existing = peerConnectionsRef.current[peerId]
    if (existing) return existing

    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS })
    peerConnectionsRef.current[peerId] = pc

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current)
      })
    }

    pc.onicecandidate = event => {
      if (event.candidate && socketRef.current?.connected) {
        socketRef.current.emit('signal', { to: peerId, data: { candidate: event.candidate } })
      }
    }

    pc.ontrack = event => {
      const [stream] = event.streams
      if (stream) {
        setRemoteStreams(prev => ({ ...prev, [peerId]: stream }))
        startVoiceMeter(stream, peerId)
      }
    }

    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        cleanupPeer(peerId)
      }
    }

    return pc
  }

  async function connectToPeer(peerId, shouldOffer) {
    const pc = await ensurePeerConnection(peerId)
    if (!shouldOffer || !socketRef.current?.connected) return pc
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    socketRef.current.emit('signal', { to: peerId, data: { sdp: pc.localDescription } })
    return pc
  }

  async function handleAuthAction() {
    setAuthBusy(true)
    setAuthError('')
    try {
      const endpoint = authForm.mode === 'login' ? '/auth/login' : '/auth/register'
      const response = await fetch(`${SERVER}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authForm.username.trim(), password: authForm.password }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Auth failed')
      const nextAuth = { token: payload.token, user: payload.user }
      setAuth(nextAuth)
      saveStoredAuth(nextAuth)
    } catch (error) {
      setAuthError(error.message)
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleGuestAction() {
    setAuthBusy(true)
    setAuthError('')
    try {
      const response = await fetch(`${SERVER}/auth/guest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authForm.username.trim() || 'Guest' }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Guest session failed')
      const nextAuth = { token: payload.token, user: payload.user }
      setAuth(nextAuth)
      saveStoredAuth(nextAuth)
    } catch (error) {
      setAuthError(error.message)
    } finally {
      setAuthBusy(false)
    }
  }

  function logout() {
    saveStoredAuth(null)
    setAuth(null)
    setParticipants([])
    setCurrentRoom(null)
    currentRoomRef.current = null
    setSpeaking({})
    setRemoteStreams({})
    setInviteMessage('')
    setMobileSidebarOpen(false)
    leaveRoom(true)
  }

  async function joinRoom(roomId) {
    setJoinError('')
    if (!socketRef.current?.connected) {
      setJoinError('Connecting to voice server...')
      return
    }

    setMobileSidebarOpen(false)

    if (currentRoomRef.current?.id && currentRoomRef.current.id !== roomId) {
      leaveRoom()
    }

    const stream = await ensureLocalStream()
    if (!stream) return
    socketRef.current.emit('join-room', { roomId })
  }

  function leaveRoom(silent = false) {
    if (currentRoomRef.current?.id && socketRef.current?.connected) {
      socketRef.current.emit('leave-room', { roomId: currentRoomRef.current.id })
    }
    Object.keys(peerConnectionsRef.current).forEach(cleanupPeer)
    Object.keys(meterCleanupsRef.current).forEach(stopVoiceMeter)
    setParticipants([])
    setCurrentRoom(null)
    currentRoomRef.current = null
    setRemoteStreams({})
    setSpeaking({})
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop())
      localStreamRef.current = null
    }
    if (!silent) setJoinError('')
  }

  async function createRoom() {
    const response = await fetch(`${SERVER}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: roomName.trim() || 'New Room', capacity: Number(roomCapacity) || 10 }),
    })
    const payload = await response.json()
    if (response.ok) {
      refreshRooms()
      await joinRoom(payload.id)
    }
  }

  async function createInvite(roomId, permanent) {
    setInviteBusy(true)
    setInviteMessage('')
    setInviteCopied(false)
    try {
      const response = await fetch(`${SERVER}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, permanent }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Invite failed')
      const url = `${window.location.origin}/invite/${payload.token}`
      setInviteMessage(url)
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url).then(() => setInviteCopied(true)).catch(() => {})
      }
    } catch (error) {
      setInviteMessage(error.message)
    } finally {
      setInviteBusy(false)
    }
  }

  async function copyInviteLink(url) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url)
      setInviteCopied(true)
      window.setTimeout(closeInviteToast, 1200)
    }
  }

  const inviteView = route.kind === 'invite'

  if (inviteView) {
    return (
      <div className="page invite-page">
        <div className="invite-frame card">
          <div className="invite-frame-top">
            <div className="brand-mini">
              <span className="brand-mark"><Icon name="spark" size={14} /></span>
              <span>Voice invite</span>
            </div>
            <button className="ghost mini" onClick={() => navigate('/')}>Home</button>
          </div>
          {inviteData?.error ? (
            <>
              <h1>Invite unavailable</h1>
              <p>{inviteData.error}</p>
              <button className="primary" onClick={() => navigate('/')}>Back home</button>
            </>
          ) : (
            <>
              <h1>{inviteData?.room?.name || 'Loading room...'}</h1>
              <p>{inviteData?.invite ? formatExpiry(inviteData.invite.expiresAt) : 'Checking invite...'}</p>
              <div className="invite-meta-row">
                <div className="invite-stat">
                  <span className="invite-stat-label">Room</span>
                  <span>{inviteData?.room?.participants?.length || 0} members</span>
                </div>
                <div className="invite-stat">
                  <span className="invite-stat-label">Access</span>
                  <span>{inviteData?.invite?.permanent ? 'Permanent' : '24h link'}</span>
                </div>
              </div>
              <div className="invite-participants stack">
                {(inviteData?.room?.participants || []).map(member => (
                  <ParticipantCard key={member.socketId} participant={member} speaking={false} />
                ))}
              </div>
              <div className="actions-row">
                <button
                  className="primary"
                  disabled={!inviteData?.room?.id || !auth}
                  onClick={async () => {
                    await joinRoom(inviteData.room.id)
                    navigate('/')
                  }}
                >
                  Join Room
                </button>
                  <button className="ghost" onClick={() => navigate('/')}>Go home</button>
              </div>
              {!auth ? <div className="hint">Sign in or use guest mode before joining.</div> : null}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
      <div className={`app-shell ${mobileSidebarOpen ? 'sidebar-open' : ''}`}>
        <nav className="guild-rail card">
          <button className="guild-home" onClick={() => navigate('/')} aria-label="Home">
            <span className="guild-home-mark"><Icon name="spark" size={15} /></span>
          </button>
          <Divider />
          <button className={`guild-pill ${!currentRoom ? 'active' : ''}`} onClick={() => setMobileSidebarOpen(true)}>
            <Icon name="home" size={18} />
          </button>
          <button className="guild-pill secondary" onClick={refreshRooms}>
            <Icon name="plus" size={18} />
          </button>
        </nav>

        <aside className="sidebar card">
          <div className="sidebar-header">
            <div className="brand">
              <div className="brand-badge">DV</div>
              <div>
                <div className="brand-title">Voice Hub</div>
                <div className="brand-subtitle">{socketStatus}</div>
              </div>
            </div>
            <button className="ghost icon-only mobile-close" onClick={() => setMobileSidebarOpen(false)} aria-label="Close sidebar">
              <Icon name="leave" size={18} />
            </button>
          </div>

          <div className="sidebar-search">
            <Icon name="search" size={16} />
            <input value={roomName} onChange={e => setRoomName(e.target.value)} placeholder="Search or name a room" />
          </div>

          <div className="sidebar-meta">
            <div>
              <span className="sidebar-meta-label">Rooms</span>
              <strong>{roomStats.total}</strong>
            </div>
            <div>
              <span className="sidebar-meta-label">Connected</span>
              <strong>{roomStats.active}</strong>
            </div>
          </div>

          <AuthPanel
            value={authForm}
            onChange={setAuthForm}
            onSubmit={handleAuthAction}
            onGuest={handleGuestAction}
            busy={authBusy}
            error={authError}
          />

          <div className="section-title">Voice rooms</div>
          <div className="room-list">
            {rooms.map(room => (
              <ChannelItem
                key={room.id}
                name={room.name}
                count={`${room.count || 0}/${room.capacity}`}
                active={currentRoom?.id === room.id}
                onClick={() => {
                  setMobileSidebarOpen(false)
                  joinRoom(room.id)
                }}
              />
            ))}
          </div>

          <div className="room-create compact">
            <input value={roomCapacity} onChange={e => setRoomCapacity(e.target.value)} type="number" min="2" max="10" />
            <button className="primary" onClick={createRoom}>
              <Icon name="plus" size={16} />
              Create room
            </button>
          </div>
        </aside>

        <main className="main-view">
          <header className="topbar card">
            <button className="ghost icon-only mobile-menu" onClick={() => setMobileSidebarOpen(true)} aria-label="Open sidebar">
              <Icon name="menu" size={18} />
            </button>
            <div className="topbar-room">
              <div className="eyebrow">{currentRoom ? 'Live room' : 'No room selected'}</div>
              <div className="topbar-title">{currentRoom ? currentRoom.name : user.username}</div>
              <div className="topbar-subtitle">
                <span>{activeRoomMembers.length} people</span>
                <span>{socketStatus}</span>
              </div>
            </div>
            <div className="topbar-actions">
              <button className={`toggle ${muted ? 'active' : ''}`} onClick={() => {
                const next = !muted
                setMuted(next)
                const track = localStreamRef.current?.getAudioTracks()[0]
                if (track) track.enabled = !next
              }}>
                <Icon name="mic" size={16} />
                {muted ? 'Muted' : 'Mic'}
              </button>
              <button className={`toggle ${deafened ? 'active' : ''}`} onClick={() => setDeafened(!deafened)}>
                <Icon name="headphones" size={16} />
                {deafened ? 'Deafened' : 'Audio'}
              </button>
              <button className="ghost" onClick={() => leaveRoom()}>
                <Icon name="leave" size={16} />
                Leave
              </button>
              <button className="ghost" onClick={logout}>
                <Icon name="settings" size={16} />
                Logout
              </button>
            </div>
          </header>

          {!currentRoom ? (
            <section className="empty-state card">
              <div className="empty-badge"><Icon name="spark" size={18} /></div>
              <h1>Pick a room and start talking</h1>
              <p>Join instantly, create a link, and see who is speaking in real time.</p>
              {joinError ? <div className="error">{joinError}</div> : null}
              <div className="empty-actions">
                <button className="primary" onClick={() => setMobileSidebarOpen(true)}>
                  <Icon name="home" size={16} />
                  Browse rooms
                </button>
                <button className="ghost" onClick={refreshRooms}>Refresh</button>
              </div>
            </section>
          ) : (
            <section className="room-panel card">
              <div className="room-panel-header">
                <div>
                  <div className="eyebrow">Voice room</div>
                  <h1>{currentRoom.name}</h1>
                  <p>{activeRoomMembers.length}/{currentRoom.capacity} connected</p>
                </div>
                <div className="room-actions">
                  <button className="primary" disabled={inviteBusy} onClick={() => createInvite(currentRoom.id, false)}>
                    <Icon name="link" size={16} />
                    Create 24h invite
                  </button>
                  <button className="ghost" disabled={inviteBusy} onClick={() => createInvite(currentRoom.id, true)}>
                    <Icon name="lock" size={16} />
                    Permanent invite
                  </button>
                </div>
              </div>

              {inviteMessage ? (
                <div className="invite-output">
                  <div>
                    <span className="invite-output-label">Invite link</span>
                    <span>{inviteMessage}</span>
                  </div>
                  <button className="ghost" onClick={() => copyInviteLink(inviteMessage)}>
                    <Icon name="copy" size={16} />
                    {inviteCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              ) : null}

              {joinError ? <div className="error">{joinError}</div> : null}

              <div className="participants-grid">
                {activeRoomMembers.map(member => (
                  <ParticipantCard key={member.socketId} participant={member} speaking={Boolean(speaking[member.socketId])} isSelf={member.self} />
                ))}
              </div>

              <div className="room-footnote">
                <div>
                  <span className="footnote-label">Presence</span>
                  <strong>{participants.length} remote peers</strong>
                </div>
                <div>
                  <span className="footnote-label">Voice transport</span>
                  <strong>WebRTC mesh</strong>
                </div>
                <div>
                  <span className="footnote-label">Server</span>
                  <strong>{socketStatus}</strong>
                </div>
              </div>

              <audio id="local-audio" autoPlay muted playsInline className="hidden-audio" />
              {Object.entries(remoteStreams).map(([peerId, stream]) => (
                <RemoteAudio key={peerId} stream={stream} muted={deafened} />
              ))}
            </section>
          )}
        </main>

        {mobileSidebarOpen ? <button className="sidebar-backdrop" onClick={() => setMobileSidebarOpen(false)} aria-label="Close sidebar backdrop" /> : null}
      </div>
  )
}

function RemoteAudio({ stream, muted }) {
  const ref = useRef(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream
      ref.current.muted = muted
      ref.current.play().catch(() => {})
    }
  }, [stream, muted])

  return <audio ref={ref} autoPlay playsInline className="hidden-audio" />
}
