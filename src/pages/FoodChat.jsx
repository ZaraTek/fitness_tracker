import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { resizeToBase64 } from '../image'

// Chat with Claude to log food: describe a meal, attach a photo, refine it,
// then add the suggested items to today's log.
export default function FoodChat({ onSave, context }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([]) // {role, text, image?, items?, added?:Set}
  const [text, setText] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [messages, busy])

  async function send(e) {
    e.preventDefault()
    if ((!text.trim() && !file) || busy) return
    setBusy(true)
    setError('')
    try {
      const image = file ? await resizeToBase64(file, 1024) : undefined
      const userMsg = { role: 'user', text: text.trim(), image }
      const history = [...messages, userMsg]
      setMessages(history)
      setText('')
      setFile(null)

      const { data, error } = await supabase.functions.invoke('food-chat', {
        body: {
          context,
          messages: history.map((m) => ({
            role: m.role,
            text: m.text,
            image: m.image,
            mediaType: m.image ? 'image/jpeg' : undefined,
          })),
        },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setMessages([...history, { role: 'assistant', text: data.reply, items: data.items ?? [], added: [] }])
    } catch (err) {
      setError('Chat failed: ' + (err.message || err))
    }
    setBusy(false)
  }

  async function add(msgIndex, itemIndex) {
    const m = messages[msgIndex]
    if (m.added.includes(itemIndex)) return
    await onSave(m.items[itemIndex])
    setMessages((all) =>
      all.map((x, i) => (i === msgIndex ? { ...x, added: [...x.added, itemIndex] } : x)),
    )
  }

  async function addAll(msgIndex) {
    const m = messages[msgIndex]
    for (let i = 0; i < m.items.length; i++) if (!m.added.includes(i)) await add(msgIndex, i)
  }

  if (!open) return <button className="wide" onClick={() => setOpen(true)}>💬 Chat to log food</button>

  return (
    <div className="card chat">
      <div className="row">
        <h3>Chat to log food</h3>
        <div>
          {messages.length > 0 && (
            <button className="link" onClick={() => setMessages([])}>Clear</button>
          )}
          <button className="link" onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>

      <div className="chat-log">
        {!messages.length && (
          <p className="muted small">
            Describe what you ate (“2 eggs, toast with butter, black coffee”) or attach a photo. Correct me
            if I’m off (“that was a small bowl”), then add the result to your log.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={'bubble ' + m.role}>
            {m.image && <img src={`data:image/jpeg;base64,${m.image}`} alt="Attached food" />}
            {m.text && <p>{m.text}</p>}
            {m.items?.map((it, j) => (
              <div className="item" key={j}>
                <div>
                  <b>{it.name}</b>
                  <div className="muted small">
                    {Math.round(it.calories)} kcal · P {Math.round(it.protein)} · C {Math.round(it.carbs)} · F{' '}
                    {Math.round(it.fat)}
                  </div>
                </div>
                <button className="primary" disabled={m.added.includes(j)} onClick={() => add(i, j)}>
                  {m.added.includes(j) ? '✓' : 'Add'}
                </button>
              </div>
            ))}
            {m.items?.length > 1 && m.added.length < m.items.length && (
              <button className="link" onClick={() => addAll(i)}>Add all</button>
            )}
          </div>
        ))}
        {busy && <div className="bubble assistant muted">Thinking…</div>}
        <div ref={endRef} />
      </div>

      {error && <div className="error">{error}</div>}

      <form className="chat-input" onSubmit={send}>
        <label className="file-btn attach" title="Attach photo">
          {file ? '🖼️' : '📷'}
          <input type="file" accept="image/*" hidden onChange={(e) => setFile(e.target.files[0] ?? null)} />
        </label>
        <input
          placeholder={file ? 'Add a note (optional)' : 'What did you eat?'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="primary" disabled={busy || (!text.trim() && !file)}>Send</button>
      </form>
    </div>
  )
}
