import React, { useEffect, useState, useRef } from 'react'
import io from 'socket.io-client'

// Determine server URL:
// - If `VITE_SERVER_URL` set at build time (recommended for Netlify), use it.
// - Otherwise fall back to same origin (useful when proxying or during local dev with reverse proxy).
const SERVER = import.meta.env.VITE_SERVER_URL || window.location.origin.replace(/:\d+$/, ':4000')

function Sidebar({ rooms, onJoin, activeRoom }) {
  return (
    <div className="sidebar">
      <h2>Rooms</h2>
      <ul>
        {rooms.map(r => (
          <li key={r.id} className={activeRoom===r.id? 'active':''} onClick={() => onJoin(r.id)}>
            <div>{r.name}</div>
            <div className="count">{r.count || 0}/{r.capacity}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Participant({ p, localMuted }) {
  return (
    <div className="participant">
      <div className="avatar" style={{background:p.avatarColor}}></div>
      <div className="meta">
        <div className="name">{p.username || 'Anon'}</div>
      </div>
      <div className={`speaking ${p.speaking? 'on':''}`}></div>
    </div>
  )
}

export default function App() {
  const [socket, setSocket] = useState(null)
  const [rooms, setRooms] = useState([])
  const [activeRoom, setActiveRoom] = useState(null)
  const [participants, setParticipants] = useState([])
  const [username, setUsername] = useState('Guest')
  const localStreamRef = useRef(null)
  const pcsRef = useRef({})
  const audioElsRef = useRef({})
  const [muted, setMuted] = useState(false)

  useEffect(()=>{
    fetch(SERVER + '/rooms').then(r=>r.json()).then(setRooms).catch(()=>{});
    const s = io(SERVER, {
      // prefer websocket transport; socket.io will upgrade if needed
      transports: ['websocket', 'polling'],
      // automatic reconnection with exponential backoff
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelayMax: 5000,
    });
    setSocket(s);

    s.on('connect', ()=>{
      s.emit('auth:identify', { username });
    });

    s.on('room-update', ({ participants }) => {
      // create local participant list
      setParticipants(participants.map(p => ({ ...p, speaking: false })));
    });

    s.on('peer-joined', ({ socketId, username, avatarColor }) => {
      // existing peers will be notified — the mesh flow will start when we join
    });

    s.on('signal', async ({ from, data }) => {
      if (!localStreamRef.current) return;
      let pc = pcsRef.current[from];
      if (!pc) {
        pc = createPeerConnection(from, s);
        pcsRef.current[from] = pc;
      }
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          s.emit('signal', { to: from, data: { sdp: pc.localDescription } });
        }
      } else if (data.candidate) {
        try { await pc.addIceCandidate(data.candidate); } catch(e){}
      }
    });

    return ()=> s.close();
  }, []);

  function createPeerConnection(peerId, s) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));
    }
    pc.onicecandidate = (e) => { if (e.candidate) s.emit('signal', { to: peerId, data: { candidate: e.candidate } }); };
    pc.ontrack = (e) => {
      // attach remote stream to audio element
      const el = audioElsRef.current[peerId] = audioElsRef.current[peerId] || document.createElement('audio');
      el.srcObject = e.streams[0];
      el.autoplay = true;
      el.play().catch(()=>{});
    };
    return pc;
  }

  async function joinRoom(roomId) {
    setActiveRoom(roomId);
    // get mic
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = s;
      // create own audio element muted
      const localAudio = document.getElementById('local-audio');
      if (localAudio) { localAudio.srcObject = s; localAudio.muted = true; }
    } catch (e) {
      alert('Microphone access required');
      return;
    }
    socket.emit('join-room', { roomId });
  }

  function leaveRoom() {
    if (!activeRoom) return;
    socket.emit('leave-room', { roomId: activeRoom });
    // close pcs
    Object.values(pcsRef.current).forEach(pc => pc.close());
    pcsRef.current = {};
    setParticipants([]);
    setActiveRoom(null);
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t=>t.stop());
      localStreamRef.current = null;
    }
  }

  function toggleMute() {
    if (!localStreamRef.current) return;
    localStreamRef.current.getAudioTracks().forEach(t => t.enabled = muted);
    setMuted(!muted);
  }

  return (
    <div className="app">
      <Sidebar rooms={rooms} onJoin={joinRoom} activeRoom={activeRoom} />
      <div className="main">
        <div className="topbar">
          <div>Logged in as <strong>{username}</strong></div>
          <div className="controls">
            <button onClick={toggleMute}>{muted? 'Unmute':'Mute'}</button>
            <button onClick={leaveRoom}>Leave</button>
          </div>
        </div>
        <div className="room">
          {activeRoom ? (
            <div>
              <h3>Room: {rooms.find(r=>r.id===activeRoom)?.name}</h3>
              <div className="participants">
                {participants.map(p => <Participant key={p.socketId} p={p} />)}
              </div>
            </div>
          ) : (
            <div className="lobby">Select or create a room to join</div>
          )}
        </div>
      </div>
      <audio id="local-audio" />
    </div>
  )
}
