import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  fetchModels,
  fetchHistory,
  fetchSessions,
  clearHistory,
  streamChat,
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
  fetchChatDebug,
  type ModelInfo,
  type ChatMessage,
  type SessionInfo,
  type SessionSettings,
  type PromptPreset,
  type CharacterInfo,
  type PersonaInfo,
  type WorldInfo,
  type CompiledPrompt,
  type GenerationResult,
} from "../lib/api";
import ModelSelector from "../components/ModelSelector";
import MarkdownView from "../components/MarkdownView";
import Avatar from "../components/ui/Avatar";
import IconButton from "../components/ui/IconButton";
import Button from "../components/ui/Button";
import Composer from "../components/ui/Composer";
import Sheet from "../components/ui/Sheet";
import SessionRow from "../components/ui/SessionRow";
import EmptyState from "../components/ui/EmptyState";
import { Textarea } from "../components/ui/Input";
import { useResearcherMode } from "../lib/mode";
import { useContextPanelPref } from "../lib/contextPanel";
import { usePinnedSessions, togglePin } from "../lib/pins";
import { startNewSession, newSessionId } from "../lib/session";
import { NARRATION_STYLES, extractNarrationStyle, applyNarrationStyle } from "../lib/narrationStyle";
import "./activeChat.css";

type DebugData = {
  session_id: string;
  settings: SessionSettings;
  compiled: CompiledPrompt;
  history_count: number;
  approx_turn: number;
  relationship: string;
  state: Record<string, unknown>;
  generation: GenerationResult | null;
};

function DebugSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details open style={{ display: "grid", gap: 6 }}>
      <summary style={{ cursor: "pointer", fontSize: 11, fontWeight: 700, color: "var(--text-primary)" }}>{title}</summary>
      <div style={{ display: "grid", gap: 6 }}>{children}</div>
    </details>
  );
}

function DebugJson({ value }: { value: unknown }) {
  return (
    <pre
      style={{
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        fontSize: 10,
        lineHeight: 1.6,
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 8,
        padding: 10,
        maxHeight: 220,
        overflowY: "auto",
        color: "var(--text-primary)",
        margin: 0,
      }}
    >
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  );
}

export default function ActiveChat() {
  const params = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const sessionId = params.sessionId ?? "default";

  const [researcher, setResearcher] = useResearcherMode();
  const ctxPanel = useContextPanelPref();
  const pinned = usePinnedSessions();

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelId, setModelId] = useState(() => localStorage.getItem("my-zeta-model") || "");
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
  const [studioOpen, setStudioOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);
  const [presets, setPresets] = useState<PromptPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [showNsfw, setShowNsfw] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugData, setDebugData] = useState<DebugData | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const settingsLoadedRef = useRef(false);
  const autoSaveTimer = useRef<number | null>(null);
  const requestEpochRef = useRef(0);
  const sendingRef = useRef(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const sessionGenRef = useRef(0);
  const activeSessionRef = useRef(sessionId);
  activeSessionRef.current = sessionId;

  const activeCharacter = characters.find((c: any) => c.id === characterId) as any;
  const activeWorld = worlds.find((w) => w.id === worldId);
  const headerName = activeCharacter?.display_name ?? (sessionId === "default" ? "きゃるる" : sessionId);
  const currentNarrationStyle = extractNarrationStyle(systemPrompt);

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
      setSessions(await fetchSessions());
    } catch {
      // ignore
    }
  };

  const loadHistory = async (sid: string) => {
    const gen = sessionGenRef.current;
    try {
      const h = await fetchHistory(sid);
      if (gen !== sessionGenRef.current || sid !== activeSessionRef.current) return;
      const filtered = h.filter((x) => x.role !== "system").map((x) => ({ id: (x as any).id as number | undefined, role: x.role, content: x.content }));
      setMessages(filtered);
      setError(null);
    } catch (e) {
      if (gen === sessionGenRef.current) setError(`履歴の取得に失敗: ${String(e)}`);
    }
  };

  const loadPresets = async () => {
    try {
      setPresets(await fetchPresets(showNsfw));
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
    const gen = sessionGenRef.current;
    settingsLoadedRef.current = false;
    setSettingsReady(false);
    if (autoSaveTimer.current) {
      window.clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    // 別セッションの値が残らないよう、読み込み前にリセット
    setSystemPrompt("");
    setTemperature(0.8);
    setCharacterId(null);
    setPersonaId(null);
    setWorldId(null);
    setIntro("");
    setSettingsStatus(null);
    try {
      const s = await fetchSettings(sid);
      if (gen !== sessionGenRef.current) return;
      setSystemPrompt(s.system_prompt);
      setTemperature(s.temperature);
      setCharacterId(s.character_id ?? null);
      setPersonaId(s.persona_id ?? null);
      setWorldId(s.world_id ?? null);
      setIntro(s.intro ?? "");
      settingsLoadedRef.current = true;
      setSettingsReady(true);
    } catch {
      if (gen === sessionGenRef.current) setError("設定の読み込みに失敗しました。再読み込みしてください。");
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

  const handleSelectNarrationStyle = (id: string | null) => {
    const next = applyNarrationStyle(systemPrompt, id as any);
    setSystemPrompt(next);
  };

  const loadDebug = async () => {
    const gen = sessionGenRef.current;
    setDebugLoading(true);
    setDebugError(null);
    try {
      const d = await fetchChatDebug(sessionId);
      if (gen !== sessionGenRef.current) return;
      setDebugData(d as DebugData);
    } catch {
      if (gen !== sessionGenRef.current) return;
      setDebugError("デバッグ情報を取得できませんでした");
      setDebugData(null);
    } finally {
      if (gen === sessionGenRef.current) setDebugLoading(false);
    }
  };

  const handleStop = () => {
    requestEpochRef.current += 1;
    sendingRef.current = false;
    if (stopRef.current) {
      stopRef.current();
      stopRef.current = null;
    }
    setStreaming(false);
    void loadHistory(sessionId);
  };

  useEffect(() => {
    reloadModels();
    loadSessions();
    loadPresets();
    loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadPresets();
    loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNsfw]);

  useEffect(() => {
    // セッション切替時: 進行中のストリームを中断し、古い非同期結果を無効化
    sessionGenRef.current += 1;
    requestEpochRef.current += 1;
    sendingRef.current = false;
    setMessages([]);
    setDebugData(null);
    setInput("");
    if (stopRef.current) {
      stopRef.current();
      stopRef.current = null;
    }
    setStreaming(false);
    loadHistory(sessionId);
    loadSettings(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (modelId) localStorage.setItem("my-zeta-model", modelId);
  }, [modelId]);

  // 自動保存：設定変更から800ms後にDBへ永続化（セッション世代で古い保存を無効化）
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
    const gen = sessionGenRef.current;
    autoSaveTimer.current = window.setTimeout(async () => {
      if (gen !== sessionGenRef.current) return;
      try {
        await saveSettings({ session_id: sessionId, system_prompt: systemPrompt, temperature, character_id: characterId, persona_id: personaId, world_id: worldId, intro });
        if (gen !== sessionGenRef.current) return;
        setSettingsStatus("自動保存 ✓");
        setTimeout(() => setSettingsStatus((prev) => (prev === "自動保存 ✓" ? null : prev)), 1800);
      } catch (e) {
        if (gen === sessionGenRef.current) setSettingsStatus(String(e));
      }
    }, 800);
    return () => {
      if (autoSaveTimer.current) {
        window.clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = null;
      }
    };
  }, [systemPrompt, temperature, characterId, personaId, worldId, intro, sessionId]);

  // Ctrl+Shift+D: Researcherのみデバッグドロワーを開閉（設定Sheetはギアボタンで開く）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        if (!researcher) return;
        e.preventDefault();
        setDebugOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [researcher]);

  useEffect(() => {
    if (debugOpen) loadDebug();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugOpen, sessionId]);

  useEffect(() => {
    if (!studioOpen) return;
    const t = window.setTimeout(async () => {
      try {
        const c = await compilePrompt({ character_id: characterId, persona_id: personaId, world_id: worldId, extra_system_prompt: systemPrompt });
        setCompiled(c);
      } catch {
        // ignore
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [characterId, personaId, worldId, systemPrompt, studioOpen]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // アンマウント時に進行中のストリームを中断
  useEffect(() => {
    return () => {
      sessionGenRef.current += 1;
      requestEpochRef.current += 1;
      sendingRef.current = false;
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      if (stopRef.current) {
        stopRef.current();
        stopRef.current = null;
      }
    };
  }, []);

  const handleNewSession = async () => {
    const id = newSessionId();
    setSessions((prev) => [{ session_id: id, count: 0, last_at: new Date().toISOString(), last_preview: "(新規会話)" }, ...prev]);
    navigate(`/chats/${encodeURIComponent(id)}`);
  };

  const handleClearSession = async () => {
    if (!confirm(`会話 "${sessionId}" を削除しますか？`)) return;
    await clearHistory(sessionId);
    setMessages([]);
    loadSessions();
  };

  const send = async (regenerateId?: number) => {
    const text = input.trim();
    if ((!text && !regenerateId) || sendingRef.current || !modelId || !settingsReady) return;
    const previous = messages;
    const next: ChatMessage[] = regenerateId
      ? messages.slice(0, -1)
      : [...messages, { role: "user", content: text }];
    if (next.at(-1)?.role !== "user") return;
    sendingRef.current = true;
    const epoch = ++requestEpochRef.current;
    const gen = sessionGenRef.current;
    const current = () => epoch === requestEpochRef.current && gen === sessionGenRef.current;
    setError(null);
    setStreaming(true);
    setMessages([...next, { role: "assistant", content: "" }]);
    if (!regenerateId) setInput("");
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    try {
      await saveSettings({ session_id: sessionId, system_prompt: systemPrompt, temperature,
        character_id: characterId, persona_id: personaId, world_id: worldId, intro });
    } catch (e) {
      if (current()) {
        setError(`設定保存に失敗したため送信しませんでした: ${String(e)}`);
        setMessages(previous); setInput(text); setStreaming(false); sendingRef.current = false;
      }
      return;
    }
    if (!current()) return;
    let reply = "";
    const display = (full: string) => {
      if (!current()) return;
      reply = full;
      setMessages([...next, { role: "assistant", content: full }]);
    };
    stopRef.current = streamChat(modelId, next,
      { session_id: sessionId, temperature, system_prompt: systemPrompt, regenerate_message_id: regenerateId, allow_nsfw: showNsfw }, {
        onToken: token => display(reply + token),
        onReset: full => display(full),
        onDone: full => {
          if (!current()) return;
          display(full); sendingRef.current = false; setStreaming(false); stopRef.current = null;
          void loadHistory(sessionId); void loadSessions();
          if (debugOpen) void loadDebug();
        },
        onError: e => {
          if (!current()) return;
          sendingRef.current = false; setStreaming(false); stopRef.current = null;
          setMessages(previous); if (!regenerateId) setInput(text); setError(e);
          if (debugOpen) void loadDebug();
        },
      });
  };

  const knownSessions = sessions.filter((s) => s.count > 0 || s.session_id === "default" || s.session_id === sessionId);

  return (
    <div className="k-chat-layout">
      {/* 左: セッションレール */}
      <aside className="k-chat-rail">
        <div className="k-chat-rail__head">
          <Button variant="primary" size="sm" onClick={handleNewSession}>
            ＋ 新しいチャット
          </Button>
        </div>
        <div className="k-chat-rail__list">
          {knownSessions.length === 0 && <EmptyState motif="✧" title="チャットがありません" />}
          {knownSessions.map((s) => (
            <SessionRow
              key={s.session_id}
              sessionId={s.session_id}
              name={s.session_id === "default" ? "きゃるる" : s.session_id}
              preview={s.last_preview}
              time={s.last_at}
              active={s.session_id === sessionId}
              pinned={pinned.includes(s.session_id)}
              onTogglePin={() => togglePin(s.session_id)}
            />
          ))}
        </div>
      </aside>

      {/* 中央: 会話 */}
      <div className="k-chat-main">
        <div className="k-chat-header">
          <Avatar name={headerName} seed={sessionId} size="sm" />
          <div>
            <div className="k-chat-header__name">{headerName}</div>
            {activeWorld && <div className="k-chat-header__sub">{activeWorld.display_name}</div>}
          </div>
          <div className="k-chat-header__actions">
            {!streaming && messages.at(-1)?.role === "assistant" && messages.at(-1)?.id && messages.at(-2)?.role === "user" && (
              <Button variant="ghost" size="sm" onClick={() => void send(messages.at(-1)!.id)} disabled={!settingsReady}>再生成</Button>
            )}
            {researcher && (
              <IconButton label="設定" active={studioOpen} onClick={() => setStudioOpen((v) => !v)}>
                ⚙
              </IconButton>
            )}
            {researcher && (
              <IconButton label="デバッグ (Ctrl+Shift+D)" active={debugOpen} onClick={() => setDebugOpen((v) => !v)}>
                🐞
              </IconButton>
            )}
            <IconButton label="Researcherモード切替" active={researcher} onClick={() => setResearcher(!researcher)} size="sm">
              🔬
            </IconButton>
            {ctxPanel.mode === "collapsible" && (
              <IconButton label={ctxPanel.open ? "パネルを閉じる" : "パネルを開く"} active={ctxPanel.open} onClick={() => ctxPanel.setOpen(!ctxPanel.open)}>
                ▤
              </IconButton>
            )}
          </div>
        </div>

        <div ref={listRef} className="k-chat-messages">
          <div className="k-chat-messages__inner">
            {messages.length === 0 && (
              <EmptyState motif="✦" title="まだメッセージがありません" description="話しかけてみよう。会話は自動保存され、リフレッシュしても消えません。" />
            )}
            {messages.map((m, i) => {
              const isAssistant = m.role === "assistant";
              const isStreaming = isAssistant && streaming && i === messages.length - 1;
              const isEditing = editingIdx === i;
              const role = m.role === "user" ? "user" : "character";
              return (
                <div key={m.id ?? i} style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexDirection: role === "user" ? "row-reverse" : "row", maxWidth: "92%" }}>
                    {role === "character" && <Avatar name={headerName} seed={sessionId} size="sm" />}
                    <div className={`k-bubble k-bubble--${role}`}>
                      {isEditing ? (
                        <div style={{ display: "grid", gap: 8, minWidth: 240 }}>
                          <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={Math.max(3, editText.split("\n").length)} autoFocus />
                          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                            <Button variant="ghost" size="sm" onClick={cancelEdit}>キャンセル</Button>
                            <Button variant="primary" size="sm" onClick={() => saveEdit(i)}>保存</Button>
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
                  </div>
                  {!isEditing && !isStreaming && (
                    <div className="k-chat-msg-actions">
                      <IconButton label="編集" size="sm" onClick={() => startEdit(i)}>✏️</IconButton>
                      <IconButton label="削除" size="sm" onClick={() => handleDelete(i)}>🗑️</IconButton>
                    </div>
                  )}
                </div>
              );
            })}
            {isStreamingTyping(streaming, messages) && (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Avatar name={headerName} seed={sessionId} size="sm" />
                <span style={{ color: "var(--accent-secondary)", fontSize: 20, letterSpacing: 2 }}>•••</span>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div style={{ padding: "8px 16px", background: "var(--error-bg)", color: "var(--error-text)", fontSize: 12, borderTop: "1px solid var(--error-border)", whiteSpace: "pre-wrap" }}>
            エラー: {error}
          </div>
        )}

        <div style={{ maxWidth: 920, width: "100%", margin: "0 auto" }}>
          {streaming && (
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
              <Button variant="danger" size="sm" onClick={handleStop}>■ 停止</Button>
            </div>
          )}
          <Composer value={input} onChange={setInput} onSend={() => void send()} disabled={streaming || !modelId || !settingsReady} disabledText={streaming ? "生成中..." : "会話を準備中..."} />
        </div>
      </div>

      {/* 右: ContextPanel */}
      {ctxPanel.mode === "always" ? (
        <div className={`k-chat-context-wrap`}>
          <ChatContextPanel
            activeCharacter={activeCharacter}
            activeWorld={activeWorld}
            intro={intro}
            currentNarrationStyle={currentNarrationStyle}
            onSelectNarrationStyle={handleSelectNarrationStyle}
            ctxPanel={ctxPanel}
            onNewSession={handleNewSession}
            onClearSession={handleClearSession}
            onInjectIntro={handleInjectIntro}
          />
        </div>
      ) : (
        <Sheet open={ctxPanel.open} onClose={() => ctxPanel.setOpen(false)} side="right" width="min(320px, 100vw)" topOffset={60}>
          <ChatContextPanel
            activeCharacter={activeCharacter}
            activeWorld={activeWorld}
            intro={intro}
            currentNarrationStyle={currentNarrationStyle}
            onSelectNarrationStyle={handleSelectNarrationStyle}
            ctxPanel={ctxPanel}
            onNewSession={handleNewSession}
            onClearSession={handleClearSession}
            onInjectIntro={handleInjectIntro}
          />
        </Sheet>
      )}

      {/* Studio: モデル選択/プリセット/Inspector（researcherのみ、Consumer UIから視覚的に分離） */}
      <Sheet open={researcher && studioOpen} onClose={() => setStudioOpen(false)} side="right" width="min(420px, 92vw)" topOffset={60}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>⚙ 詳細設定（Studio）</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{sessionId} {systemPrompt ? `· ${systemPrompt.length}字` : ""}</div>
          </div>
          <IconButton label="閉じる" onClick={() => setStudioOpen(false)}>×</IconButton>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "grid", gap: 14, alignContent: "start" }}>
          <label style={{ fontSize: 11, display: "flex", gap: 6, alignItems: "center", color: showNsfw ? "var(--error-text)" : "var(--text-muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={showNsfw} onChange={(e) => setShowNsfw(e.target.checked)} /> 🔞 NSFWを表示（キャラ/プリセット/シナリオ）
          </label>

          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)" }}>モデル</label>
            <ModelSelector models={models} value={modelId} onChange={setModelId} />
            <Button variant="secondary" size="sm" onClick={reloadModels} style={{ width: "fit-content" }}>↻ 再読込</Button>
          </div>

          <div style={{ display: "grid", gap: 8, padding: 12, background: "var(--bg-surface-soft)", border: "1px solid var(--border-subtle)", borderRadius: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)" }}>📚 プリセット</label>
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{presets.length}件</span>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={selectedPresetId}
                onChange={(e) => setSelectedPresetId(e.target.value)}
                style={{ flex: 1, minWidth: 140, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border-subtle)", background: "var(--bg-surface)", color: "var(--text-primary)", fontSize: 12 }}
              >
                <option value="">プリセットを選択...</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.nsfw ? "🔞" : ""} ({p.content.length}字 / temp {p.temperature})
                  </option>
                ))}
              </select>
              <Button variant="primary" size="sm" onClick={() => selectedPresetId && handleApplyPreset(selectedPresetId)} disabled={!selectedPresetId}>適用</Button>
              <Button variant="danger" size="sm" onClick={() => selectedPresetId && handleDeletePreset(selectedPresetId)} disabled={!selectedPresetId}>削除</Button>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="新しいプリセット名"
                style={{ flex: 1, minWidth: 0, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border-subtle)", background: "var(--bg-surface)", color: "var(--text-primary)", fontSize: 12 }}
              />
              <Button variant="primary" size="sm" onClick={handleSavePreset}>＋ 保存</Button>
            </div>
          </div>

          <div style={{ display: "grid", gap: 8, padding: 12, background: "var(--bg-surface-soft)", border: "1px solid var(--border-subtle)", borderRadius: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)" }}>🎭 キャラクター / 世界</div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>キャラクター</label>
            <select value={characterId ?? ""} onChange={(e) => setCharacterId(e.target.value || null)} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border-subtle)", background: "var(--bg-surface)", color: "var(--text-primary)", fontSize: 12 }}>
              <option value="">（未選択）</option>
              {characters.map((c: any) => (
                <option key={c.id} value={c.id}>{c.display_name} ({c.id}){c.nsfw ? " 🔞" : ""}</option>
              ))}
            </select>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>ペルソナ (USER)</label>
            <select value={personaId ?? ""} onChange={(e) => setPersonaId(e.target.value || null)} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border-subtle)", background: "var(--bg-surface)", color: "var(--text-primary)", fontSize: 12 }}>
              <option value="">（未選択）</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>{p.display_name} ({p.id})</option>
              ))}
            </select>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>ワールド</label>
            <select value={worldId ?? ""} onChange={(e) => setWorldId(e.target.value || null)} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border-subtle)", background: "var(--bg-surface)", color: "var(--text-primary)", fontSize: 12 }}>
              <option value="">（未選択）</option>
              {worlds.map((w) => (
                <option key={w.id} value={w.id}>{w.display_name} ({w.id})</option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>追加システムプロンプト</label>
            <Textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={5} />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>
              Temperature: <code>{temperature.toFixed(2)}</code>
            </label>
            <input type="range" min={0} max={2} step={0.05} value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} />
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Button variant="primary" size="sm" onClick={handleSaveSettings} disabled={settingsSaving}>{settingsSaving ? "保存中..." : "保存"}</Button>
            {settingsStatus && <span style={{ fontSize: 11, color: settingsStatus?.includes("✓") ? "var(--success)" : "var(--error-text)" }}>{settingsStatus}</span>}
          </div>

          {compiled && (
            <div style={{ display: "grid", gap: 6, padding: 10, background: "var(--bg-surface-soft)", border: "1px solid var(--border-subtle)", borderRadius: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)" }}>🔍 Inspector</div>
              <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11, lineHeight: 1.6, background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: 10, maxHeight: 260, overflowY: "auto", color: "var(--text-primary)" }}>{compiled.system_prompt}</pre>
            </div>
          )}
        </div>
      </Sheet>

      {/* Debug: Researcherのみ Ctrl+Shift+D で開くデバッグドロワー */}
      <Sheet open={researcher && debugOpen} onClose={() => setDebugOpen(false)} side="right" width="min(480px, 94vw)" topOffset={60}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>🐞 デバッグ <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 400, marginLeft: 6 }}>Ctrl+Shift+D</span></div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{sessionId}</div>
          </div>
          <IconButton label="閉じる" onClick={() => setDebugOpen(false)}>×</IconButton>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "grid", gap: 14, alignContent: "start" }}>
          {debugLoading && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>読込中…</div>}
          {debugError && <div style={{ fontSize: 12, color: "var(--error-text)" }}>{debugError}</div>}
          {debugData && (
            <>
              <DebugSection title="📝 生プロンプト (raw prompt)">
                <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 10, lineHeight: 1.6, background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: 10, maxHeight: 220, overflowY: "auto", color: "var(--text-primary)", margin: 0 }}>
                  {debugData.generation?.raw_prompt || debugData.compiled?.system_prompt || "(なし)"}
                </pre>
              </DebugSection>
              <DebugSection title="🔢 推定トークン内訳">
                <DebugJson value={debugData.generation?.token_budget ?? { estimated: true, compiler_tokens: debugData.compiled?.token_estimate }} />
              </DebugSection>
              <DebugSection title="💾 永続化された状態 (state)">
                <DebugJson value={debugData.state} />
              </DebugSection>
              <DebugSection title="📡 テレメトリ">
                <DebugJson value={debugData.generation?.telemetry} />
              </DebugSection>
              <DebugSection title="⚙ 生成設定 (generation_config)">
                  <div>requested: 要求 / applied: 適用 / unsupported: 未対応</div>
                <DebugJson value={debugData.generation?.generation_config} />
              </DebugSection>
              <DebugSection title="✅ 検証ログ (validation)">
                <DebugJson value={debugData.generation?.validation} />
                <details><summary>試行ごとの出力・エラー</summary><DebugJson value={debugData.generation?.attempts} /></details>
              </DebugSection>
            </>
          )}
        </div>
      </Sheet>
    </div>
  );
}

function isStreamingTyping(streaming: boolean, messages: (ChatMessage & { id?: number })[]) {
  if (!streaming) return false;
  const last = messages[messages.length - 1];
  return last?.role === "assistant" && !last.content;
}

function ChatContextPanel({
  activeCharacter,
  activeWorld,
  intro,
  currentNarrationStyle,
  onSelectNarrationStyle,
  ctxPanel,
  onNewSession,
  onClearSession,
  onInjectIntro,
}: {
  activeCharacter: any;
  activeWorld: WorldInfo | undefined;
  intro: string;
  currentNarrationStyle: string | null;
  onSelectNarrationStyle: (id: string | null) => void;
  ctxPanel: ReturnType<typeof useContextPanelPref>;
  onNewSession: () => void;
  onClearSession: () => void;
  onInjectIntro: () => void;
}) {
  return (
    <div className="k-context-panel" style={{ height: "100%" }}>
      <div className="k-context-section">
        <div className="k-context-section__title">✦ Character</div>
        {activeCharacter ? (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Avatar name={activeCharacter.display_name} seed={activeCharacter.id} size="md" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{activeCharacter.display_name}</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{activeCharacter.description}</div>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>キャラクター未選択</div>
        )}
      </div>

      {activeWorld && (
        <div className="k-context-section">
          <div className="k-context-section__title">✦ Scenario / World</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{activeWorld.display_name}</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>{activeWorld.description}</div>
        </div>
      )}

      {intro && (
        <div className="k-context-section">
          <div className="k-context-section__title">✦ Intro</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7, maxHeight: 120, overflowY: "auto" }}>{intro}</div>
        </div>
      )}

      <div className="k-context-section">
        <div className="k-context-section__title">✦ Narration style</div>
        <div className="k-narration-style-grid">
          <button className={`k-narration-style-chip ${!currentNarrationStyle ? "k-narration-style-chip--active" : ""}`} onClick={() => onSelectNarrationStyle(null)}>
            なし
          </button>
          {NARRATION_STYLES.map((s) => (
            <button key={s.id} className={`k-narration-style-chip ${currentNarrationStyle === s.id ? "k-narration-style-chip--active" : ""}`} onClick={() => onSelectNarrationStyle(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="k-context-section">
        <div className="k-context-section__title">✦ Panel behavior</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className={`k-narration-style-chip ${ctxPanel.mode === "collapsible" ? "k-narration-style-chip--active" : ""}`} onClick={() => ctxPanel.setMode("collapsible")}>
            折りたたみ可能
          </button>
          <button className={`k-narration-style-chip ${ctxPanel.mode === "always" ? "k-narration-style-chip--active" : ""}`} onClick={() => ctxPanel.setMode("always")}>
            常に表示
          </button>
        </div>
      </div>

      <div className="k-context-section" style={{ borderBottom: "none" }}>
        <div className="k-context-section__title">✦ Conversation controls</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Button variant="secondary" size="sm" onClick={onNewSession}>＋ 新しいチャット</Button>
          {intro && <Button variant="secondary" size="sm" onClick={onInjectIntro}>▶ イントロを流す</Button>}
          <Button variant="danger" size="sm" onClick={onClearSession}>この会話を削除</Button>
        </div>
      </div>
    </div>
  );
}
