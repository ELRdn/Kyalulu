import { useEffect, useRef, useState } from "react";
import {
  fetchModels,
  fetchHistory,
  fetchSessions,
  clearHistory,
  streamChat,
  fetchChatNonStream,
  fetchSettings,
  saveSettings,
  fetchPresets,
  createPreset,
  deletePreset,
  fetchCharacters,
  fetchPersonas,
  fetchWorlds,
  compilePrompt,
  updateHistoryMessage,
  deleteHistoryMessage,
  injectIntro,
  type ModelInfo,
  type ChatMessage,
  type SessionInfo,
  type SessionSettings,
  type PromptPreset,
  type CharacterInfo,
  type PersonaInfo,
  type WorldInfo,
  type CompiledPrompt,
} from "../lib/api";
import ModelSelector from "../components/ModelSelector";
import MarkdownView from "../components/MarkdownView";

const LS_SESSION = "my-zeta-session";
const LS_MODEL = "my-zeta-model";

export default function ChatPage({ researcher = false }: { researcher?: boolean }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelId, setModelId] = useState(() => localStorage.getItem(LS_MODEL) || "");
  const [sessionId, setSessionId] = useState(() => localStorage.getItem(LS_SESSION) || "default");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [messages, setMessages] = useState<(ChatMessage & { id?: number })[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState(0.8);
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [worldId, setWorldId] = useState<string | null>(null);
  const [intro, setIntro] = useState("");
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [personas, setPersonas] = useState<PersonaInfo[]>([]);
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [compiled, setCompiled] = useState<CompiledPrompt | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);
  const [presets, setPresets] = useState<PromptPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [showNsfw, setShowNsfw] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const settingsLoadedRef = useRef(false);
  const autoSaveTimer = useRef<number | null>(null);

  const reloadModels = () => {
    fetchModels()
      .then((ms) => {
        setModels(ms);
        if (ms.length > 0 && !modelId) setModelId(ms[0].id);
      })
      .catch(() => setError("モデル一覧の取得に失敗"));
  };

  const loadSessions = async () => {
    try {
      const ss = await fetchSessions();
      setSessions(ss);
    } catch {
      // ignore
    }
  };

  const loadHistory = async (sid: string) => {
    try {
      console.log("[Chat] loadHistory start", sid);
      const h = await fetchHistory(sid);
      console.log("[Chat] loadHistory got", h.length, h.slice(0, 1));
      const filtered = h.filter((x) => x.role !== "system").map((x) => ({ id: (x as any).id as number | undefined, role: x.role, content: x.content }));
      console.log("[Chat] filtered", filtered.length);
      setMessages(filtered);
      if (h.length > 0 && filtered.length === 0) {
        setError(`履歴は${h.length}件あるのに表示用に0件になりました（roleがsystemだけ？）`);
      } else if (h.length === 0) {
        console.warn("[Chat] history empty for", sid);
      } else {
        setError(null);
      }
    } catch (e) {
      console.error("[Chat] loadHistory failed", e);
      setError(`履歴の取得に失敗: ${String(e)}`);
    }
  };

  const loadPresets = async () => {
    try {
      const ps = await fetchPresets(showNsfw);
      setPresets(ps);
    } catch {
      // ignore
    }
  };

  const handleApplyPreset = (pid: string) => {
    const p = presets.find((x) => x.id === pid);
    if (!p) return;
    setSystemPrompt(p.content);
    setTemperature(p.temperature);
    setSettingsStatus(`プリセット「${p.name}」を適用`);
    setTimeout(() => setSettingsStatus((prev) => (prev?.includes(p.name) ? null : prev)), 2000);
  };

  const contentIncludesExplicit = (s: string) => /行為|挿入|絶頂|ベッドで/i.test(s);

  const handleSavePreset = async () => {
    const name = presetName.trim() || `プリセット ${new Date().toLocaleString()}`;
    if (!systemPrompt.trim()) {
      setSettingsStatus("システムプロンプトが空です");
      return;
    }
    try {
      const isNsfw = showNsfw && (characterId?.includes("night") || presetName.includes("夜") || name.includes("夜"));
      await createPreset(name, systemPrompt, temperature, isNsfw, isNsfw ? (name.includes("行為") || contentIncludesExplicit(systemPrompt) ? "explicit" : "innuendo") : null);
      setPresetName("");
      await loadPresets();
      setSettingsStatus(`プリセット「${name}」を保存 ✓`);
      setTimeout(() => setSettingsStatus(null), 2000);
    } catch (e) {
      setSettingsStatus(String(e));
    }
  };

  const handleDeletePreset = async (pid: string) => {
    const p = presets.find((x) => x.id === pid);
    if (!p || !confirm(`プリセット「${p.name}」を削除しますか？`)) return;
    try {
      await deletePreset(pid);
      await loadPresets();
      if (selectedPresetId === pid) setSelectedPresetId("");
      setSettingsStatus("削除しました");
      setTimeout(() => setSettingsStatus(null), 1500);
    } catch (e) {
      setSettingsStatus(String(e));
    }
  };

  const loadSettings = async (sid: string) => {
    settingsLoadedRef.current = false;
    if (autoSaveTimer.current) {
      window.clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    try {
      const s = await fetchSettings(sid);
      setSystemPrompt(s.system_prompt);
      setTemperature(s.temperature);
      setCharacterId(s.character_id ?? null);
      setPersonaId(s.persona_id ?? null);
      setWorldId(s.world_id ?? null);
      setIntro(s.intro ?? "");
      setSettingsStatus(null);
    } catch {
      // 無視
    } finally {
      setTimeout(() => {
        settingsLoadedRef.current = true;
      }, 100);
    }
  };

  const startEdit = (idx: number) => {
    setEditingIdx(idx);
    setEditText(messages[idx]?.content ?? "");
  };
  const cancelEdit = () => {
    setEditingIdx(null);
    setEditText("");
  };
  const saveEdit = async (idx: number) => {
    const msg = messages[idx];
    const newContent = editText.trim();
    if (!newContent) {
      setError("内容が空です");
      return;
    }
    if (msg.id) {
      try {
        await updateHistoryMessage(msg.id, newContent);
        await loadHistory(sessionId);
        await loadSessions();
      } catch (e) {
        setError(String(e));
        return;
      }
    } else {
      setMessages((prev) => {
        const c = [...prev];
        c[idx] = { ...c[idx], content: newContent };
        return c;
      });
    }
    setEditingIdx(null);
    setEditText("");
  };
  const handleDelete = async (idx: number) => {
    const msg = messages[idx];
    if (!confirm(`このメッセージを削除しますか？\n\n「${msg.content.slice(0, 40)}...」`)) return;
    if (msg.id) {
      try {
        await deleteHistoryMessage(msg.id);
        await loadHistory(sessionId);
        await loadSessions();
      } catch (e) {
        setError(String(e));
      }
    } else {
      setMessages((prev) => prev.filter((_, i) => i !== idx));
    }
  };

  const handleInjectIntro = async () => {
    try {
      const r: any = await injectIntro(sessionId);
      if (r.injected) {
        await loadHistory(sessionId);
        await loadSessions();
        setSettingsStatus("イントロを履歴に流しました ✓");
      } else {
        setSettingsStatus(r.reason === "already injected" ? "既にイントロが入っています" : "イントロは空です");
      }
      setTimeout(() => setSettingsStatus((prev) => (prev?.includes("イントロ") ? null : prev)), 2000);
    } catch (e) {
      setSettingsStatus(String(e));
    }
  };

  const loadCharacterIntro = () => {
    if (!characterId) {
      setSettingsStatus("キャラが未選択です");
      return;
    }
    const c: any = characters.find((x) => x.id === characterId);
    if (c?.intro) {
      setIntro(c.intro);
      setSettingsStatus(`「${c.display_name}」のイントロを読み込み`);
      setTimeout(() => setSettingsStatus((prev) => (prev?.includes("イントロ") ? null : prev)), 2000);
    } else {
      setSettingsStatus("このキャラにintroが無いよ");
      setTimeout(() => setSettingsStatus((prev) => (prev?.includes("intro") ? null : prev)), 2000);
    }
  };

  const loadCatalog = async () => {
    try {
      const [cs, ps, ws] = await Promise.all([fetchCharacters(showNsfw), fetchPersonas(), fetchWorlds()]);
      setCharacters(cs);
      setPersonas(ps);
      setWorlds(ws);
    } catch {
      // ignore
    }
  };

  const handleSaveSettings = async () => {
    setSettingsSaving(true);
    setSettingsStatus(null);
    try {
      const s: SessionSettings = { session_id: sessionId, system_prompt: systemPrompt, temperature, character_id: characterId, persona_id: personaId, world_id: worldId, intro };
      await saveSettings(s);
      setSettingsStatus("保存しました ✓");
      setTimeout(() => setSettingsStatus(null), 2000);
    } catch (e) {
      setSettingsStatus(String(e));
    } finally {
      setSettingsSaving(false);
    }
  };

  useEffect(() => {
    reloadModels();
    loadSessions();
    loadHistory(sessionId);
    loadPresets();
    loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadPresets();
    loadCatalog();
  }, [showNsfw]);

  useEffect(() => {
    localStorage.setItem(LS_SESSION, sessionId);
    loadHistory(sessionId);
    loadSettings(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (modelId) localStorage.setItem(LS_MODEL, modelId);
  }, [modelId]);

  // 自動保存：設定変更から800ms後にDBへ永続化（チャットと一緒に保存する原則）
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = window.setTimeout(async () => {
      try {
        await saveSettings({ session_id: sessionId, system_prompt: systemPrompt, temperature, character_id: characterId, persona_id: personaId, world_id: worldId, intro });
        setSettingsStatus("自動保存 ✓");
        setTimeout(() => setSettingsStatus((prev) => (prev === "自動保存 ✓" ? null : prev)), 1800);
      } catch (e) {
        setSettingsStatus(String(e));
      }
    }, 800);
    return () => {
      if (autoSaveTimer.current) {
        window.clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = null;
      }
    };
  }, [systemPrompt, temperature, characterId, personaId, worldId, intro, sessionId]);

  // M7: Debug Drawer 快捷键 Ctrl+Shift+D（Researcherのみ）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        if (!researcher) return;
        e.preventDefault();
        setSettingsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [researcher]);

  // Inspector: コンパイル結果を取得（設定が変わるたびに）
  useEffect(() => {
    if (!settingsOpen) return;
    const t = window.setTimeout(async () => {
      try {
        const c = await compilePrompt({ character_id: characterId, persona_id: personaId, world_id: worldId, extra_system_prompt: systemPrompt });
        setCompiled(c);
      } catch {
        // ignore
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [characterId, personaId, worldId, systemPrompt, settingsOpen]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleNewSession = () => {
    const newId = `chat_${Date.now().toString(36)}`;
    setSessionId(newId);
    setMessages([]);
    setError(null);
    setSessions((prev) => [{ session_id: newId, count: 0, last_at: new Date().toISOString(), last_preview: "(新規会話)" }, ...prev]);
  };

  const handleClearSession = async () => {
    if (!confirm(`会話 "${sessionId}" を削除しますか？`)) return;
    await clearHistory(sessionId);
    setMessages([]);
    loadSessions();
  };

  const send = async () => {
    const text = input.trim();
    if (!text || streaming || !modelId) return;
    setError(null);
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    const withAssistant: ChatMessage[] = [...next, { role: "assistant", content: "" }];
    setMessages(withAssistant);
    setInput("");
    setStreaming(true);
    let acc = "";
    let gotToken = false;
    let streamFailed = false;

    // 最速ハイブリッド: チャンクは即キューに積み、16msごとに6文字ずつ流す（溜めゼロ・ぱらぱら最速）
    const queue: string[] = [];
    let timer: number | null = null;
    let flushing = false;
    const CHARS_PER_TICK = 6;
    const TICK_MS = 16;
    const scheduleFlush = () => {
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        if (queue.length === 0) {
          flushing = false;
          return;
        }
        flushing = true;
        const take = Math.min(CHARS_PER_TICK, queue.length);
        acc += queue.splice(0, take).join("");
        setMessages((prev) => {
          if (prev.length === 0 || prev[prev.length - 1].role !== "assistant") return prev;
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
        if (queue.length > 0) scheduleFlush();
        else flushing = false;
      }, TICK_MS) as unknown as number;
    };
    const pushToken = (t: string) => {
      // チャンク単位で来たものを1文字ずつ分解して即キュー
      for (const ch of t) queue.push(ch);
      if (!flushing && queue.length > 0) {
        // 初回は待ちなしで即1回分流す
        const take = Math.min(CHARS_PER_TICK, queue.length);
        acc += queue.splice(0, take).join("");
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
        flushing = true;
        scheduleFlush();
      } else if (!timer) {
        scheduleFlush();
      }
    };

    // 送信直前に自動保存タイマーをクリアして即時保存（蒸発防止）
    if (autoSaveTimer.current) {
      window.clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    // 設定もチャットと一緒に永続化（awaitせず並行）
    saveSettings({ session_id: sessionId, system_prompt: systemPrompt, temperature, character_id: characterId, persona_id: personaId, world_id: worldId }).catch(() => {});

    const stop = streamChat(
      modelId,
      next,
      { session_id: sessionId, temperature, system_prompt: systemPrompt },
      {
        onToken: (t) => {
          gotToken = true;
          pushToken(t);
        },
        onDone: () => {
          const waitDrain = () => {
            if (queue.length > 0) setTimeout(waitDrain, TICK_MS + 8);
            else {
              if (timer !== null) {
                clearTimeout(timer);
                timer = null;
              }
              flushing = false;
              setStreaming(false);
              loadSessions();
              if (!gotToken) setTimeout(() => loadHistory(sessionId), 300);
            }
          };
          waitDrain();
        },
        onError: (e) => {
          if (timer !== null) {
            clearTimeout(timer);
            timer = null;
          }
          flushing = false;
          streamFailed = true;
          setError(e);
          setStreaming(false);
        },
      },
    );

    setTimeout(async () => {
      if (!gotToken && !streamFailed) {
        try {
          const reply = await fetchChatNonStream(modelId, next, sessionId, temperature, systemPrompt);
          for (const ch of reply) queue.push(ch);
          if (!flushing) {
            const take = Math.min(CHARS_PER_TICK, queue.length);
            acc += queue.splice(0, take).join("");
            setMessages((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = { role: "assistant", content: acc };
              return copy;
            });
            flushing = true;
            scheduleFlush();
          }
          const waitFallback = () => {
            if (queue.length > 0) setTimeout(waitFallback, TICK_MS + 8);
            else {
              setStreaming(false);
              loadSessions();
            }
          };
          waitFallback();
        } catch (e) {
          setError(String(e));
          setStreaming(false);
          loadHistory(sessionId);
        }
        stop();
      }
    }, 8000);
    void stop;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden", background: "var(--bg)" }}>
      {/* 会話選択バー */}
      <div style={{ padding: 8, borderBottom: "1px solid var(--border)", background: "var(--bg-card)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          style={{ flex: 1, minWidth: 140, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, background: "var(--bg-input)", color: "var(--text)" }}
        >
          <option value="default">default</option>
          {sessions
            .filter((s) => s.session_id !== "default")
            .map((s) => (
              <option key={s.session_id} value={s.session_id}>
                {s.session_id} ({s.count}件) {s.last_preview ? `- ${s.last_preview.slice(0, 20)}` : ""}
              </option>
            ))}
          {!sessions.find((s) => s.session_id === sessionId) && sessionId !== "default" && (
            <option value={sessionId}>{sessionId} (新規)</option>
          )}
        </select>
        <button
          onClick={handleNewSession}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--accent-text)", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}
        >
          ＋ 新規会話
        </button>
        <button
          onClick={handleClearSession}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text)", fontSize: 11, cursor: "pointer" }}
        >
          削除
        </button>
        <button
          onClick={() => loadHistory(sessionId)}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text)", fontSize: 11, cursor: "pointer" }}
        >
          ↻ 更新
        </button>
      </div>

      <div style={{ padding: 12, borderBottom: "1px solid var(--border)", background: "var(--bg-card)", display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <ModelSelector models={models} value={modelId} onChange={setModelId} />
          </div>
          <button
            onClick={reloadModels}
            title="モデル一覧を再読込"
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text)", fontSize: 12, cursor: "pointer" }}
          >
            ↻
          </button>
          {researcher ? (
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              title="システムプロンプト設定 (Ctrl+Shift+D)"
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: settingsOpen ? "1px solid var(--accent)" : "1px solid var(--border)",
                background: settingsOpen ? "var(--accent)" : "var(--bg-card)",
                color: settingsOpen ? "var(--accent-text)" : "var(--text-muted)",
                fontSize: 12,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              ⚙ 設定 {systemPrompt ? "●" : ""}
            </button>
          ) : (
            <span style={{ fontSize: 10, color: "var(--text-faint)", border: "1px dashed var(--border)", padding: "6px 8px", borderRadius: 8, whiteSpace: "nowrap" }}>
              🔬 Researcherで設定を表示
            </span>
          )}
        </div>
        {researcher && models.find((m) => m.id === modelId) && (
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
            provider: <code>{models.find((m) => m.id === modelId)?.provider_type}</code> / model:{" "}
            <code>{models.find((m) => m.id === modelId)?.provider_model}</code> / session: <code>{sessionId}</code>
            {systemPrompt && <> / system: <code style={{ color: "#10b981" }}>あり ({systemPrompt.length}字)</code></>}
            {(characterId || personaId || worldId) && (
              <> / char: <code style={{ color: "#8b5cf6" }}>{[characterId, personaId, worldId].filter(Boolean).join("/")}</code></>
            )}
          </div>
        )}
      </div>

      <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12, background: "var(--bg-subtle)" }}>
        {messages.length === 0 && (
          <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", marginTop: 40 }}>
            モデルを選んで話しかけてみよう。会話は自動保存され、リフレッシュしても消えません。
          </div>
        )}
        {messages.map((m, i) => {
          const isAssistant = m.role === "assistant";
          const isStreaming = isAssistant && streaming && i === messages.length - 1;
          const isEditing = editingIdx === i;
          return (
            <div key={m.id ?? i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "92%", display: "flex", flexDirection: "column", gap: 6 }}>
              <div
                style={{
                  width: "fit-content",
                  maxWidth: "100%",
                  minWidth: 120,
                  padding: "12px 16px",
                  borderRadius: 14,
                  background: m.role === "user" ? "var(--user-bg)" : "var(--assistant-bg)",
                  color: m.role === "user" ? "var(--user-text)" : "var(--assistant-text)",
                  border: m.role === "assistant" ? "1px solid var(--assistant-border)" : "none",
                  fontSize: 14,
                  lineHeight: 1.7,
                  overflow: "visible",
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                  boxShadow: m.role === "assistant" ? "var(--overlay-shadow)" : "none",
                }}
              >
                {isEditing ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={Math.max(3, editText.split("\n").length)}
                      style={{ width: "100%", minWidth: 240, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text)", fontSize: 13, lineHeight: 1.6, resize: "vertical" }}
                      autoFocus
                    />
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button onClick={cancelEdit} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text)", fontSize: 11, cursor: "pointer" }}>キャンセル</button>
                      <button onClick={() => saveEdit(i)} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "var(--accent)", color: "var(--accent-text)", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>保存</button>
                    </div>
                  </div>
                ) : m.role === "user" ? (
                  <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
                ) : m.content ? (
                  <MarkdownView content={m.content} isStreaming={isStreaming} />
                ) : isStreaming ? (
                  "▍"
                ) : null}
              </div>
              {!isEditing && !isStreaming && (
                <div style={{ display: "flex", gap: 6, alignSelf: m.role === "user" ? "flex-end" : "flex-start" }}>
                  <button onClick={() => startEdit(i)} title="編集" style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-dim)", fontSize: 11, cursor: "pointer" }}>✏️ 編集</button>
                  <button onClick={() => handleDelete(i)} title="削除" style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--error-text)", fontSize: 11, cursor: "pointer" }}>🗑️ 削除</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div style={{ padding: "8px 12px", background: "var(--error-bg)", color: "var(--error-text)", fontSize: 12, borderTop: "1px solid var(--error-border)", whiteSpace: "pre-wrap" }}>
          エラー: {error}
        </div>
      )}

      <div style={{ padding: 12, borderTop: "1px solid var(--border)", background: "var(--bg-card)", display: "flex", gap: 8, flexShrink: 0, alignItems: "flex-end" }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
            // Shift+Enter はデフォルトで改行（\n）が入る
          }}
          placeholder={streaming ? "生成中..." : "メッセージを入力 (Enterで送信, Shift+Enterで改行)"}
          disabled={streaming}
          rows={1}
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--bg-input)",
            color: "var(--text)",
            fontSize: 13,
            outline: "none",
            resize: "none",
            minHeight: 42,
            maxHeight: 160,
            overflowY: "auto",
            lineHeight: 1.6,
            fontFamily: "inherit",
            fontWeight: 500,
          }}
          onInput={(e) => {
            const t = e.target as HTMLTextAreaElement;
            t.style.height = "auto";
            t.style.height = Math.min(t.scrollHeight, 160) + "px";
          }}
        />
        <button
          onClick={send}
          disabled={streaming || !input.trim() || !modelId}
          style={{
            padding: "10px 16px",
            borderRadius: 10,
            border: "none",
            background: streaming || !input.trim() ? "var(--border)" : "var(--accent)",
            color: streaming || !input.trim() ? "var(--text-dim)" : "var(--accent-text)",
            fontSize: 13,
            fontWeight: 600,
            cursor: streaming || !input.trim() ? "not-allowed" : "pointer",
          }}
        >
          {streaming ? "..." : "送信"}
        </button>
      </div>

      {/* 右ドロワー用オーバーレイ — Researcherのみ */}
      {researcher && settingsOpen && (
        <div
          onClick={() => setSettingsOpen(false)}
          style={{ position: "fixed", inset: 0, top: 48, background: "rgba(0,0,0,0.35)", zIndex: 40, backdropFilter: "blur(1px)" }}
        />
      )}
      {/* 右ドロワー本体 — Debug Drawer (Ctrl+Shift+D) */}
      <div
        style={{
          position: "fixed",
          top: 48,
          right: 0,
          bottom: 0,
          width: "min(420px, 92vw)",
          background: "var(--bg-card)",
          borderLeft: "1px solid var(--border)",
          boxShadow: researcher && settingsOpen ? "-8px 0 24px rgba(0,0,0,0.15)" : "none",
          transform: researcher && settingsOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.24s cubic-bezier(0.32,0.72,0,1)",
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* ヘッダー */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>⚙ 設定 <span style={{ fontSize: 10, color: "var(--text-faint)", fontWeight: 400, marginLeft: 6 }}>Ctrl+Shift+D</span></div>
            <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{sessionId} {systemPrompt ? `· ${systemPrompt.length}字` : ""}</div>
          </div>
          <button
            onClick={() => setSettingsOpen(false)}
            style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
          >
            ×
          </button>
        </div>
        {/* スクロール内容 */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "grid", gap: 14, alignContent: "start" }}>
          <label style={{ fontSize: 11, display: "flex", gap: 6, alignItems: "center", color: showNsfw ? "var(--error-text)" : "var(--text-dim)", cursor: "pointer" }}>
            <input type="checkbox" checked={showNsfw} onChange={(e) => setShowNsfw(e.target.checked)} /> 🔞 NSFWを表示（キャラ/プリセット/シナリオ）
          </label>
          {/* プリセット */}
          <div style={{ display: "grid", gap: 8, padding: 12, background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>📚 プリセット</label>
              <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{presets.length}件 {showNsfw ? "(NSFW含む)" : ""}</span>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={selectedPresetId}
                onChange={(e) => setSelectedPresetId(e.target.value)}
                style={{ flex: 1, minWidth: 140, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text)", fontSize: 12 }}
              >
                <option value="">プリセットを選択...</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.nsfw ? "🔞" : ""} ({p.content.length}字 / temp {p.temperature})
                  </option>
                ))}
              </select>
              <button
                onClick={() => selectedPresetId && handleApplyPreset(selectedPresetId)}
                disabled={!selectedPresetId}
                style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: !selectedPresetId ? "var(--border)" : "var(--accent)", color: !selectedPresetId ? "var(--text-dim)" : "var(--accent-text)", fontSize: 11, cursor: !selectedPresetId ? "not-allowed" : "pointer", fontWeight: 600 }}
              >
                適用
              </button>
              <button
                onClick={() => selectedPresetId && handleDeletePreset(selectedPresetId)}
                disabled={!selectedPresetId}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: !selectedPresetId ? "var(--text-dim)" : "var(--error-text)", fontSize: 11, cursor: !selectedPresetId ? "not-allowed" : "pointer" }}
              >
                削除
              </button>
              <button onClick={loadPresets} title="再読込" style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text)", fontSize: 11, cursor: "pointer" }}>
                ↻
              </button>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="新しいプリセット名"
                style={{ flex: 1, minWidth: 0, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text)", fontSize: 12 }}
              />
              <button onClick={handleSavePreset} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--accent-text)", fontSize: 11, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>
                ＋ 保存
              </button>
            </div>
          </div>

          {/* Character Runtime */}
          <div style={{ display: "grid", gap: 8, padding: 12, background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>🎭 キャラクター / 世界</div>
            <div style={{ fontSize: 10, color: "var(--text-dim)" }}>選ぶと Compiler が最終 system_prompt を合成。未選択なら直書きが使われます。</div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>キャラクター</label>
            <select value={characterId ?? ""} onChange={(e) => setCharacterId(e.target.value || null)} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text)", fontSize: 12 }}>
              <option value="">（未選択）</option>
              {characters.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.display_name} ({c.id}){c.nsfw ? " 🔞" : ""}
                </option>
              ))}
            </select>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>ペルソナ (USER)</label>
            <select value={personaId ?? ""} onChange={(e) => setPersonaId(e.target.value || null)} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text)", fontSize: 12 }}>
              <option value="">（未選択）</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name} ({p.id})
                </option>
              ))}
            </select>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>ワールド</label>
            <select value={worldId ?? ""} onChange={(e) => setWorldId(e.target.value || null)} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text)", fontSize: 12 }}>
              <option value="">（未選択）</option>
              {worlds.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.display_name} ({w.id})
                </option>
              ))}
            </select>
            <button onClick={loadCatalog} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text)", fontSize: 11, cursor: "pointer", width: "fit-content" }}>
              ↻ 再読込
            </button>
          </div>

          {/* イントロ */}
          <div style={{ display: "grid", gap: 6, padding: 10, background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>🎬 イントロ（初回アシスタントの一言）</label>
              <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{intro.length} / 10000</span>
            </div>
            <div style={{ fontSize: 10, color: "var(--text-dim)" }}>会話が空のときに「履歴に流す」で最初のメッセージとして表示。キャラ変更時は「読み込む」でデフォを入れられます。</div>
            <textarea
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              placeholder="例: *夕暮れの教室で…* こんにちは、人間ちゃん♡"
              rows={4}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, lineHeight: 1.6, resize: "vertical", outline: "none", fontFamily: "inherit", background: "var(--bg-input)", color: "var(--text)" }}
            />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button onClick={loadCharacterIntro} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text)", fontSize: 11, cursor: "pointer" }}>
                ↳ キャラのイントロを読み込む
              </button>
              <button onClick={handleInjectIntro} disabled={!intro.trim()} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: !intro.trim() ? "var(--border)" : "var(--accent)", color: !intro.trim() ? "var(--text-dim)" : "var(--accent-text)", fontSize: 11, cursor: !intro.trim() ? "not-allowed" : "pointer", fontWeight: 600 }}>
                ▶ 履歴に流す
              </button>
              <button onClick={() => setIntro("")} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-dim)", fontSize: 11, cursor: "pointer" }}>
                クリア
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>追加システムプロンプト（キャラ選択時は追記）</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="例: 語尾に「にゃ」を付けて"
              rows={4}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, lineHeight: 1.6, resize: "vertical", outline: "none", fontFamily: "inherit", background: "var(--bg-input)", color: "var(--text)" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-dim)" }}>
              <span>会話ごとに自動保存</span>
              <span>{systemPrompt.length} / 10000</span>
            </div>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>
              Temperature: <code style={{ background: "var(--bg-subtle)", padding: "1px 6px", borderRadius: 4, border: "1px solid var(--border)" }}>{temperature.toFixed(2)}</code>
            </label>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input type="range" min={0} max={2} step={0.05} value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} style={{ flex: 1 }} />
              <input type="number" min={0} max={2} step={0.05} value={temperature} onChange={(e) => setTemperature(Math.max(0, Math.min(2, parseFloat(e.target.value) || 0)))} style={{ width: 72, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text)", fontSize: 12 }} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={handleSaveSettings}
              disabled={settingsSaving}
              style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: settingsSaving ? "var(--border)" : "var(--accent)", color: settingsSaving ? "var(--text-dim)" : "var(--accent-text)", fontSize: 12, fontWeight: 600, cursor: settingsSaving ? "not-allowed" : "pointer" }}
            >
              {settingsSaving ? "保存中..." : "保存"}
            </button>
            <button
              onClick={() => {
                setSystemPrompt("");
                setTemperature(0.8);
                setCharacterId(null);
                setPersonaId(null);
                setWorldId(null);
                setIntro("");
              }}
              style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text)", fontSize: 11, cursor: "pointer" }}
            >
              リセット
            </button>
            {settingsStatus && <span style={{ fontSize: 11, color: settingsStatus?.includes("✓") ? "#10b981" : "var(--error-text)" }}>{settingsStatus}</span>}
          </div>

          {compiled && (
            <div style={{ display: "grid", gap: 6, padding: 10, background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>🔍 Inspector</div>
                <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{compiled!.prompt_version} / ~{compiled!.token_estimate} tokens</span>
              </div>
              <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11, lineHeight: 1.6, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, maxHeight: 260, overflowY: "auto", color: "var(--text)" }}>{compiled!.system_prompt}</pre>
              <details style={{ fontSize: 11 }}>
                <summary style={{ cursor: "pointer", color: "var(--text-muted)" }}>sections</summary>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 10, background: "var(--bg-card)", padding: 8, borderRadius: 6, marginTop: 6, overflowX: "auto", border: "1px solid var(--border)" }}>{JSON.stringify(compiled!.sections, null, 2)}</pre>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


