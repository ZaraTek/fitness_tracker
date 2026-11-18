import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { resizeToBase64 } from '../image'

const fmt = (it) =>
  `${Math.round(it.calories)} kcal · P ${Math.round(it.protein)} · C ${Math.round(it.carbs)} · F ${Math.round(it.fat)}`

// Chat with Claude to log food: describe a meal or attach a photo and the
// estimate goes straight into the log. Corrections replace the last logged items.
export default function FoodChat({ onSave, onRemove, context }) {
  const [open, setOpen] = useState(false)
  // {role, text, image?, items?, loggedIds?: string[], status?: 'logged'|'replaced'|'undone'}
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [messages, busy])

  async function removeIds(ids) {
    for (const id of ids) await onRemove(id)
  }

  async function send(e) {
    e.preventDefault()
    if ((!text.trim() && !file) || busy) return
    setBusy(true)
    setError('')
    const userText = text.trim()
    const userFile = file
    try {
      const image = userFile ? await resizeToBase64(userFile, 1024) : undefined
      const userMsg = { role: 'user', text: userText, image }
      let history = [...messages, userMsg]
      setMessages(history)
      setText('')
      setFile(null)

      const { data, error } = await supabase.functions.invoke('food-chat', {
        body: {
          context,
          messages: history.map((m) => ({
            role: m.role,
            // Tell the model what actually got logged so corrections make sense.
            text:
              m.role === 'assistant' && m.items?.length
                ? `${m.text}\n[${m.status === 'undone' ? 'Undone by user' : 'Logged'}: ${m.items
                    .map((it) => `${it.name} (${fmt(it)})`)
                    .join('; ')}]`
                : m.text,
            image: m.image,
            mediaType: m.image ? 'image/jpeg' : undefined,
          })),
        },
      })
      if (error) throw new Error(await errorText(error))
      if (data?.error) throw new Error(data.error)
      if (!data?.reply && !data?.items?.length) throw new Error('Empty response, please try again.')

      const items = data.items ?? []
      let loggedIds = []
      if (items.length) {
        if (data.action === 'replace') {
          const prevIdx = history.findLastIndex((m) => m.status === 'logged')
          if (prevIdx >= 0) {
            await removeIds(history[prevIdx].loggedIds)
            history = history.map((m, i) => (i === prevIdx ? { ...m, status: 'replaced' } : m))
          }
        }
        for (const it of items) {
          const row = await onSave(it)
          if (row) loggedIds.push(row.id)
        }
      }
      setMessages([
        ...history,
        {
          role: 'assistant',
          text: data.reply,
          items,
          loggedIds,
          status: loggedIds.length ? 'logged' : undefined,
        },
      ])
    } catch (err) {
      setError('Chat failed: ' + (err.message || err))
      // Put the message back so it can be retried.
      setMessages((m) => (m[m.length - 1]?.role === 'user' ? m.slice(0, -1) : m))
      setText(userText)
      setFile(userFile)
    }
    setBusy(false)
  }

  async function undo(i) {
    await removeIds(messages[i].loggedIds)
    setMessages((all) => all.map((m, j) => (j === i ? { ...m, status: 'undone' } : m)))
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
            Tell me what you ate (“2 eggs, toast with butter, black coffee”) or attach a photo and I’ll log it.
            Correct me if I’m off (“that was a small bowl”) and I’ll update the entry.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={'bubble ' + m.role}>
            {m.image && <img src={`data:image/jpeg;base64,${m.image}`} alt="Attached food" />}
            {m.text && <p>{m.text}</p>}
            {m.items?.map((it, j) => (
              <div className={'item' + (m.status === 'logged' ? '' : ' struck')} key={j}>
                <div>
                  <b>{it.name}</b>
                  <div className="muted small">{fmt(it)}</div>
                </div>
              </div>
            ))}
            {m.status === 'logged' && (
              <div className="row small">
                <span className="good">✓ Logged</span>
                <button className="link" onClick={() => undo(i)}>Undo</button>
              </div>
            )}
            {m.status === 'replaced' && <span className="muted small">Replaced by the correction below</span>}
            {m.status === 'undone' && <span className="muted small">Removed from log</span>}
          </div>
        ))}
        {busy && (
          <div className="bubble assistant" aria-label="Thinking">
            <span className="typing"><i /><i /><i /></span>
          </div>
        )}
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

// supabase-js hides the function's JSON error behind a generic message.
async function errorText(error) {
  try {
    const body = await error.context?.json()
    if (body?.error) return body.error
  } catch {
    // not JSON
  }
  return error.message
}
