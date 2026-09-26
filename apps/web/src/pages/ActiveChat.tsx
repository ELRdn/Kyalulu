import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
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
  fetchSuggestions,
  fetchCommands,
  runCommand,
  type MemoryTrace,
  type SlashCommand,
  type CommandResult,
  type ChatMessage,
  type SessionInfo,
  type SessionSettings,
  type PromptPreset,
  type CharacterInfo,
  type PersonaInfo,
  type WorldInfo,
  type CompiledPrompt,
  type GenerationResult,
  sessionTitle,
} from "../lib/api";
import ModelSelector from "../components/ModelSelector";
import PortableSessionControls from '../components/PortableSessionControls';
import { fetchLibraryItem, assetUrl, type LibraryItem, type LibraryBinding } from '../lib/library';
import MessageContent from "../components/MessageContent";
import Icon from "../components/ui/Icon";
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
import { newSessionId, startNewSession } from "../lib/session";
import { useChatModel } from "../lib/models";
import { useAdultContent } from "../lib/adult";
import { friendlyError } from "../lib/errors";
import MemoryPanel from "../components/MemoryPanel";
import StoryControls from "../components/StoryControls";
import MemoryInspector from "../components/MemoryInspector";
import { useDocumentTitle } from "../lib/title";
import Dialog, { useConfirm } from "../components/ui/Dialog";
import { getReplyVersions, recordReplyVersion, selectReplyVersion } from "../lib/replyVersions";
import { cleanPreview } from "../lib/text";
import { useMediaQuery } from "../lib/useMediaQuery";
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
  memory?: MemoryTrace | null;
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

  const { models, modelId, setModelId, reload: reloadModels, loadFailed: modelsFailed } = useChatModel();
  const [adult] = useAdultContent();
  const [confirmDialog, confirm] = useConfirm();
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
  const [libraryBinding, setLibraryBinding] = useState<LibraryBinding | null>(null);
  const [portableCharacter, setPortableCharacter] = useState<LibraryItem | null>(null);
  const [portableOpen, setPortableOpen] = useState(false);
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
  const [showNsfw, setShowNsfw] = useState(adult);
  const [debugOpen, setDebugOpen] = useState(false);
  const [versionTick, setVersionTick] = useState(0);
  const [directiveOpen, setDirectiveOpen] = useState(false);
  const [directive, setDirective] = useState("");
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [commandResult, setCommandResult] = useState<CommandResult | null>(null);
  const [commandRunning, setCommandRunning] = useState(false);
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
  const sessionInfo = sessions.find((s) => s.session_id === sessionId);
  const headerName = portableCharacter?.document.name ?? activeCharacter?.display_name ?? sessionInfo?.character_name ?? sessionTitle({ session_id: sessionId, character_name: null });
  const portrait = assetUrl(libraryBinding?.expression_asset_id) ?? assetUrl(portableCharacter?.document.assets.find(a => a.type === 'icon')?.asset_id) ?? activeCharacter?.portrait_url ?? sessionInfo?.portrait_url;
  const hasCharacter = !!(characterId || portableCharacter);
  const [railQuery, setRailQuery] = useState("");
  const wide = useMediaQuery("(min-width: 1280px)");
  const panelDocked = ctxPanel.mode === "always" && wide;
  const selectableCharacters = useMemo(() => characters.filter((c: any) => showNsfw || !c.nsfw || c.id === characterId), [characters, showNsfw, characterId]);
  useEffect(() => {
    let active = true;
    setPortableCharacter(null);
    if (characterId?.startsWith('lib_')) fetchLibraryItem(characterId, libraryBinding?.character?.revision).then(item => {
      if (active) setPortableCharacter(item);
    }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [characterId, libraryBinding?.character?.revision, sessionId]);
  const currentNarrationStyle = extractNarrationStyle(systemPrompt);
  useDocumentTitle(settingsReady ? headerName : null);

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
    if (!p || !(await confirm({ title: `プリセット「${p.name}」を削除しますか？`, confirmLabel: "削除する", danger: true }))) return;
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
    setLibraryBinding(null);
    setPortableCharacter(null);
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
      setLibraryBinding(s.library_binding ?? null);
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
    if (!(await confirm({ title: "このメッセージを削除しますか？", description: <div className="k-confirm__quote">{cleanPreview(msg.content, 80)}</div>, confirmLabel: "削除する", danger: true }))) return;
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
      const [cs, ps, ws] = await Promise.all([fetchCharacters(true), fetchPersonas(), fetchWorlds()]);
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
      const s: SessionSettings = { session_id: sessionId, system_prompt: systemPrompt, temperature, character_id: characterId, persona_id: personaId, world_id: worldId, intro, library_binding: libraryBinding };
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

  useEffect(() => setShowNsfw(adult), [adult]);

  useEffect(() => {
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
    setSuggestions(null);
    if (stopRef.current) {
      stopRef.current();
      stopRef.current = null;
    }
    setStreaming(false);
    loadHistory(sessionId);
    loadSettings(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // 自動保存：設定変更から800ms後にDBへ永続化（セッション世代で古い保存を無効化）
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
    const gen = sessionGenRef.current;
    autoSaveTimer.current = window.setTimeout(async () => {
      if (gen !== sessionGenRef.current) return;
      try {
        await saveSettings({ session_id: sessionId, system_prompt: systemPrompt, temperature, character_id: characterId, persona_id: personaId, world_id: worldId, intro, library_binding: libraryBinding });
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
  }, [systemPrompt, temperature, characterId, personaId, worldId, intro, sessionId, libraryBinding]);

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
        const c = await compilePrompt({ character_id: characterId, persona_id: personaId, world_id: worldId, extra_system_prompt: systemPrompt, library_binding: libraryBinding });
        setCompiled(c);
      } catch {
        // ignore
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [characterId, personaId, worldId, systemPrompt, studioOpen, libraryBinding]);

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
    setSessions((prev) => [{ session_id: id, count: 0, last_at: new Date().toISOString(), last_preview: null }, ...prev]);
    navigate(`/chats/${encodeURIComponent(id)}`);
  };

  const handleClearSession = async () => {
    if (!(await confirm({ title: `${headerName}との会話を削除しますか？`, description: "メッセージはすべて消え、元に戻せません。", confirmLabel: "削除する", danger: true }))) return;
    try {
      await clearHistory(sessionId);
    } catch (e) {
      setError(String(e));
      return;
    }
    ctxPanel.setOpen(false);
    navigate("/chats");
  };

  // 同じキャラクター（・ワールド）で、はじまりのシーンから新しく話す
  const handleRestartWithCharacter = async () => {
    if (!characterId) return handleNewSession();
    try {
      const id = await startNewSession({ characterId, personaId, worldId, intro, temperature });
      ctxPanel.setOpen(false);
      navigate(`/chats/${encodeURIComponent(id)}`);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    fetchCommands().then(setCommands).catch(() => setCommands([]));
  }, []);

  // 「/」で始まる入力はチャットに送らず、API のコマンドとして実行する（履歴には残らない）
  const runSlash = async (text: string) => {
    setCommandRunning(true);
    setCommandResult({ ok: true, command: text.split(" ")[0], output: "実行中…", refresh_models: false });
    try {
      const result = await runCommand(text);
      setCommandResult(result);
      if (result.refresh_models) reloadModels();
      if (result.ok) setInput("");
    } catch (e) {
      setCommandResult({ ok: false, command: text.split(" ")[0], output: String(e), refresh_models: false });
    } finally {
      setCommandRunning(false);
    }
  };

  const send = async (regenerateId?: number, request?: string) => {
    const text = input.trim();
    if (!regenerateId && text.startsWith("/")) {
      if (!commandRunning) void runSlash(text);
      return;
    }
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
    const replaced = regenerateId ? messages.at(-1)?.content ?? "" : "";
    setError(null);
    setSuggestions(null);
    setStreaming(true);
    setMessages([...next, { role: "assistant", content: "" }]);
    if (!regenerateId) setInput("");
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    try {
      await saveSettings({ session_id: sessionId, system_prompt: systemPrompt, temperature,
          character_id: characterId, persona_id: personaId, world_id: worldId, intro, library_binding: libraryBinding });
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
      { session_id: sessionId, temperature, regenerate_message_id: regenerateId, allow_nsfw: showNsfw,
        // 「注文して作り直す」はこの1回の生成だけに指示を足す（保存される設定は変えない）
        system_prompt: request ? `${systemPrompt.trim()}\n\n# この返事だけの注文\n${request}`.trim() : systemPrompt }, {
        onToken: token => display(reply + token),
        onReset: full => display(full),
        onDone: full => {
          if (!current()) return;
          display(full); sendingRef.current = false; setStreaming(false); stopRef.current = null;
          if (regenerateId && replaced && full) {
            recordReplyVersion(sessionId, regenerateId, replaced, full);
            setVersionTick((v) => v + 1);
          }
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

  const lastMsg = messages.at(-1);
  const replyVersions = useMemo(
    () => (lastMsg?.role === "assistant" && lastMsg.id ? getReplyVersions(sessionId, lastMsg.id) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, lastMsg?.id, versionTick],
  );
  const showVersion = async (index: number) => {
    const id = lastMsg?.id;
    if (!replyVersions || !id || streaming) return;
    const content = replyVersions.versions[index];
    if (content === undefined) return;
    selectReplyVersion(sessionId, id, index);
    setVersionTick((v) => v + 1);
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content } : m)));
    try {
      await updateHistoryMessage(id, content);
    } catch (e) {
      setError(String(e));
    }
  };
  const submitDirective = () => {
    const req = directive.trim();
    const id = lastMsg?.id;
    if (!req || !id) return;
    setDirectiveOpen(false);
    setDirective("");
    void send(id, req);
  };
  const handleSuggest = async () => {
    if (suggestions) return setSuggestions(null);
    if (!modelId || suggesting) return;
    setSuggesting(true);
    setError(null);
    const sid = sessionId;
    try {
      const list = await fetchSuggestions(modelId, sid, messages.map(({ role, content }) => ({ role, content })), showNsfw);
      if (sid !== activeSessionRef.current) return;
      if (list.length === 0) setError("返事の候補を作れませんでした。もう一度試してね。");
      else setSuggestions(list);
    } catch (e) {
      if (sid === activeSessionRef.current) setError(String(e));
    } finally {
      setSuggesting(false);
    }
  };

  const friendly = error ? friendlyError(error) : null;
  const knownSessions = sessions.filter((s) => s.count > 0 || s.session_id === "default" || s.session_id === sessionId);
  const railNeedle = railQuery.trim().toLowerCase();
  const railSessions = railNeedle ? knownSessions.filter((s) => `${sessionTitle(s)} ${cleanPreview(s.last_preview, 300)}`.toLowerCase().includes(railNeedle)) : knownSessions;
  const railPinned = railSessions.filter((s) => pinned.includes(s.session_id));
  const railRecent = railSessions.filter((s) => !pinned.includes(s.session_id));
  const worldNameOf = (id?: string | null) => worlds.find((w) => w.id === id)?.display_name;
  const canRegenerate = !streaming && messages.at(-1)?.role === "assistant" && !!messages.at(-1)?.id && messages.at(-2)?.role === "user";
  const starters = hasCharacter
    ? ["こんにちは！はじめまして", "今日はどんな一日だった？", "きみのこと、もっと教えて", "*そっと隣に座る*"]
    : ["こんにちは！", "おすすめの話題はある？", "物語をいっしょに作ろう"];

  const contextPanel = (
    <ChatContextPanel
      name={headerName}
      seed={characterId ?? sessionId}
      portrait={portrait}
      activeCharacter={activeCharacter}
      characterId={characterId}
      activeWorld={activeWorld}
      intro={intro}
      currentNarrationStyle={currentNarrationStyle}
      onSelectNarrationStyle={handleSelectNarrationStyle}
      ctxPanel={ctxPanel}
      docked={panelDocked}
      onClose={() => ctxPanel.setOpen(false)}
      onNewSession={handleRestartWithCharacter}
      onClearSession={handleClearSession}
      onInjectIntro={handleInjectIntro}
      sessionId={sessionId}
      memoryRefresh={messages.length * 2 + (streaming ? 1 : 0)}
      settings={{ personaId, personas, worldId, worlds, systemPrompt, setPersonaId, setWorldId, setSystemPrompt, settingsReady, streaming }}
    />
  );

  const railGroup = (title: string, list: SessionInfo[]) =>
    list.length > 0 && (
      <div className="k-chat-rail__group">
        <div className="k-chat-rail__label">{title}</div>
        {list.map((s) => (
          <SessionRow
            key={s.session_id}
            session={s.session_id === sessionId ? { ...s, character_name: s.character_name ?? (hasCharacter ? headerName : null), portrait_url: s.portrait_url ?? portrait } : s}
            worldName={worldNameOf(s.world_id)}
            active={s.session_id === sessionId}
            pinned={pinned.includes(s.session_id)}
            onTogglePin={() => togglePin(s.session_id)}
          />
        ))}
      </div>
    );

  return (
    <div className="k-chat-layout">
      {confirmDialog}
      <Dialog open={directiveOpen} onClose={() => setDirectiveOpen(false)} labelledBy="k-directive-title">
        <form className="k-confirm" onSubmit={(e) => { e.preventDefault(); submitDirective(); }}>
          <h2 id="k-directive-title" className="k-confirm__title">どんな返事にしたい？</h2>
          <p className="k-confirm__desc">いまの返事を、この注文に沿って作り直します。注文はこの1回だけに使われます。</p>
          <Textarea value={directive} onChange={(e) => setDirective(e.target.value)} rows={3} maxLength={300} placeholder="例：もっと照れた感じで / 話を少し進めて / 短めに" data-autofocus />
          <div className="k-directive-presets">
            {["もっと甘く", "もっと短く", "話を進めて", "照れた感じで", "情景をくわしく"].map((t) => (
              <button key={t} type="button" className="k-chip" onClick={() => setDirective(t)}>{t}</button>
            ))}
          </div>
          <div className="k-confirm__actions">
            <Button variant="ghost" type="button" onClick={() => setDirectiveOpen(false)}>やめる</Button>
            <Button variant="primary" type="submit" disabled={!directive.trim()}>
              <Icon name="wand" size={15} /> 作り直す
            </Button>
          </div>
        </form>
      </Dialog>
      {/* 左: セッションレール */}
      <aside className="k-chat-rail" aria-label="会話リスト">
        <div className="k-chat-rail__head">
          <Button variant="primary" onClick={handleNewSession} className="k-chat-rail__new">
            <Icon name="plus" size={16} /> 新しいチャット
          </Button>
          <div className="k-chat-rail__search">
            <Icon name="search" size={15} />
            <input value={railQuery} onChange={(e) => setRailQuery(e.target.value)} placeholder="チャットを検索…" aria-label="チャットを検索" />
          </div>
        </div>
        <div className="k-chat-rail__list">
          {railSessions.length === 0 && <EmptyState motif="✧" title={railNeedle ? "見つかりませんでした" : "チャットがありません"} />}
          {railGroup("ピン留め", railPinned)}
          {railGroup("最近のチャット", railRecent)}
        </div>
      </aside>

      {/* 中央: 会話 */}
      <div className="k-chat-main">
        <div className="k-chat-header">
          <Link to="/chats" className="k-chat-header__back" aria-label="チャット一覧へ戻る">
            <Icon name="back" size={18} />
          </Link>
          <button type="button" className="k-chat-header__who" onClick={() => ctxPanel.setOpen(!ctxPanel.open)} aria-label={`${headerName}の情報を表示`}>
            <span className="k-chat-header__avatar">
              <Avatar name={headerName} seed={characterId ?? sessionId} size="md" src={portrait} mascot={!hasCharacter} />
              <span className="k-chat-header__status" aria-hidden="true" />
            </span>
            <span className="k-chat-header__identity">
              <span className="k-chat-header__name" title={headerName}>{headerName}</span>
              <span className="k-chat-header__sub">{activeWorld ? `✦ ${activeWorld.display_name}` : streaming ? "入力中…" : "オンライン"}</span>
            </span>
          </button>
          <div className="k-chat-header__actions">
            <IconButton label="キャラ・プリセット" active={portableOpen} onClick={() => setPortableOpen((v) => !v)}>
              <Icon name="book" size={17} />
            </IconButton>
            {researcher && (
              <IconButton label="詳細設定（Studio）" active={studioOpen} onClick={() => setStudioOpen((v) => !v)}>
                <Icon name="settings" size={17} />
              </IconButton>
            )}
            {researcher && (
              <IconButton label="デバッグ (Ctrl+Shift+D)" active={debugOpen} onClick={() => setDebugOpen((v) => !v)}>
                <Icon name="bug" size={17} />
              </IconButton>
            )}
            {!panelDocked && (
              <IconButton label={ctxPanel.open ? "情報パネルを閉じる" : "情報パネルを開く"} active={ctxPanel.open} onClick={() => ctxPanel.setOpen(!ctxPanel.open)}>
                <Icon name="panel" size={17} />
              </IconButton>
            )}
          </div>
        </div>

        <div ref={listRef} className="k-chat-messages">
          <div className="k-chat-messages__inner">
            {messages.length === 0 && settingsReady && (
              <div className="k-chat-welcome">
                <div className="k-chat-welcome__art">
                  <Avatar name={headerName} seed={characterId ?? sessionId} size="xl" src={portrait} mascot={!hasCharacter} />
                </div>
                <h2 className="k-chat-welcome__title">{hasCharacter ? `${headerName}と話してみよう` : "なにを話そうか？"}</h2>
                <p className="k-chat-welcome__desc">
                  {hasCharacter ? "最初のひとことを送ってみて。会話は自動で保存されるよ。" : "キャラクターを選ぶと、その子らしい会話ができるよ。"}
                </p>
                <div className="k-chat-welcome__starters">
                  {starters.map((t) => (
                    <button key={t} type="button" className="k-starter" onClick={() => setInput(t)}>
                      {t}
                    </button>
                  ))}
                </div>
                {!hasCharacter && (
                  <Button variant="secondary" onClick={() => navigate("/discover")}>
                    <Icon name="compass" size={15} /> キャラクターを探す
                  </Button>
                )}
              </div>
            )}
            {messages.map((m, i) => {
              const isAssistant = m.role === "assistant";
              const isStreaming = isAssistant && streaming && i === messages.length - 1;
              const isEditing = editingIdx === i;
              const role = m.role === "user" ? "user" : "character";
              const showMeta = role === "character" && messages[i - 1]?.role !== "assistant";
              if (isStreaming && !m.content) return null;
              return (
                <div key={m.id ?? i} className={`k-msg k-msg--${role} ${isEditing ? "is-editing" : ""} ${i === messages.length - 1 ? "is-latest" : ""}`}>
                  {role === "character" ? (
                    <span className="k-msg__avatar">{showMeta && <Avatar name={headerName} seed={characterId ?? sessionId} size="md" src={portrait} mascot={!hasCharacter} />}</span>
                  ) : null}
                  <div className="k-msg__col">
                    {showMeta && (
                      <div className="k-msg__meta">
                        <span className="k-msg__name">{headerName}</span>
                      </div>
                    )}
                    {isEditing ? (
                      <div className="k-msg__editor">
                        <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={Math.max(3, editText.split("\n").length)} autoFocus />
                        <div className="k-msg__editor-actions">
                          <Button variant="ghost" size="sm" onClick={cancelEdit}>キャンセル</Button>
                          <Button variant="primary" size="sm" onClick={() => saveEdit(i)}>保存</Button>
                        </div>
                      </div>
                    ) : role === "user" ? (
                      <div className="k-bubble k-bubble--user">{m.content}</div>
                    ) : (
                      <MessageContent content={m.content} isStreaming={isStreaming} />
                    )}
                    {!isEditing && !isStreaming && (
                      <div className="k-msg__actions">
                        {isAssistant && i === messages.length - 1 && replyVersions && (
                          <span className="k-msg__versions" role="group" aria-label="返事の案を切り替える">
                            <button type="button" className="k-msg__action k-msg__action--icon" onClick={() => void showVersion(replyVersions.index - 1)} disabled={replyVersions.index <= 0} aria-label="前の案">
                              <Icon name="back" size={14} />
                            </button>
                            <span className="k-msg__versions-count" aria-live="polite">
                              {replyVersions.index + 1}/{replyVersions.versions.length}
                            </span>
                            <button type="button" className="k-msg__action k-msg__action--icon" onClick={() => void showVersion(replyVersions.index + 1)} disabled={replyVersions.index >= replyVersions.versions.length - 1} aria-label="次の案">
                              <Icon name="chevron" size={14} />
                            </button>
                          </span>
                        )}
                        {isAssistant && i === messages.length - 1 && canRegenerate && (
                          <>
                            <button type="button" className="k-msg__action" onClick={() => void send(messages.at(-1)!.id)} disabled={!settingsReady}>
                              <Icon name="refresh" size={14} /> 別の返事
                            </button>
                            <button type="button" className="k-msg__action" onClick={() => setDirectiveOpen(true)} disabled={!settingsReady}>
                              <Icon name="wand" size={14} /> 注文して作り直す
                            </button>
                          </>
                        )}
                        <button type="button" className="k-msg__action" onClick={() => startEdit(i)} aria-label="編集">
                          <Icon name="edit" size={14} /> 編集
                        </button>
                        <button type="button" className="k-msg__action k-msg__action--danger" onClick={() => handleDelete(i)} aria-label="削除">
                          <Icon name="trash" size={14} /> 削除
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {isStreamingTyping(streaming, messages) && (
              <div className="k-msg k-msg--character" aria-live="polite">
                <span className="k-msg__avatar">
                  <Avatar name={headerName} seed={characterId ?? sessionId} size="md" src={portrait} mascot={!hasCharacter} />
                </span>
                <div className="k-msg__col">
                  <div className="k-msg__meta">
                    <span className="k-msg__name">{headerName}</span>
                    <span className="k-msg__time">が入力中…</span>
                  </div>
                  <div className="k-typing" aria-label="入力中">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {friendly && (
          <div className="k-chat-error" role="alert">
            <Icon name="info" size={15} />
            <span className="k-chat-error__text">{friendly.message}</span>
            {friendly.action && (
              <Link to={friendly.action.to} className="k-chat-error__action">
                {friendly.action.label}
              </Link>
            )}
            {friendly.command && (
              <button
                type="button"
                className="k-chat-error__action"
                disabled={commandRunning}
                onClick={() => { const input = friendly.command!.input; setError(null); void runSlash(input); }}
                title={friendly.command.input}
              >
                {friendly.command.label}
              </button>
            )}
            <button type="button" onClick={() => setError(null)} aria-label="エラーを閉じる">
              <Icon name="close" size={14} />
            </button>
          </div>
        )}

        <div className="k-chat-composer-wrap">
          {suggestions && (
            <div className="k-suggest" role="group" aria-label="返事の候補">
              {suggestions.map((t) => (
                <button key={t} type="button" className="k-suggest__item" onClick={() => { setInput(t); setSuggestions(null); }}>
                  {t}
                </button>
              ))}
            </div>
          )}
          {commandResult && (
            <div className={`k-cmd-result ${commandResult.ok ? "" : "is-error"}`} role="status">
              <div className="k-cmd-result__head">{commandResult.command}</div>
              <pre className="k-cmd-result__body">{commandResult.output}</pre>
              <button type="button" className="k-cmd-result__close" onClick={() => setCommandResult(null)} aria-label="結果を閉じる">
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
          <Composer
            commands={commands}
            tools={
              <button
                type="button"
                className={`k-composer__tool ${suggestions ? "is-active" : ""}`}
                onClick={() => void handleSuggest()}
                disabled={!modelId || !settingsReady || streaming || suggesting || !messages.some((m) => m.role === "assistant")}
                aria-pressed={!!suggestions}
                title="次に送る返事の候補を出す"
              >
                <Icon name="sparkle" size={13} className={suggesting ? "k-spin" : undefined} /> {suggesting ? "考え中…" : "返事の候補"}
              </button>
            }
            value={input}
            onChange={setInput}
            onSend={() => void send()}
            onStop={handleStop}
            streaming={streaming}
            disabled={!modelId || !settingsReady}
            disabledText={!modelId ? (modelsFailed ? "サーバーに接続できません。アプリの起動状態を確認してね" : "会話エンジンを準備中…") : "会話を準備中…"}
            placeholder={hasCharacter ? `${headerName}への言葉を入力してね…` : "きみの言葉を入力してね…"}
          />
        </div>
      </div>

      {/* 右: ContextPanel */}
      {panelDocked ? (
        <div className="k-chat-context-wrap">{contextPanel}</div>
      ) : (
        <Sheet open={ctxPanel.open} onClose={() => ctxPanel.setOpen(false)} side="right" width="min(340px, 100vw)" topOffset={64}>
          {contextPanel}
        </Sheet>
      )}

      <Sheet open={portableOpen} onClose={() => setPortableOpen(false)} side="right" topOffset={64}>
        <div className="k-sheet-head">
          <div className="k-sheet-head__title">キャラ・プリセット</div>
          <IconButton label="閉じる" size="sm" onClick={() => setPortableOpen(false)}>
            <Icon name="close" size={15} />
          </IconButton>
        </div>
        <div style={{ padding: 18, overflowY: "auto" }}>
          <fieldset disabled={streaming || !settingsReady} style={{ border: 0, padding: 0 }}>
            <PortableSessionControls value={libraryBinding} characterId={characterId} character={portableCharacter} allowNsfw={showNsfw} onChange={setLibraryBinding} onTemperature={setTemperature} />
          </fieldset>
          <p role="status" className="k-sheet-status">{settingsStatus}</p>
        </div>
      </Sheet>
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
            <select value={characterId ?? ""} onChange={async e => {
              const id = e.target.value || null; const epoch = sessionGenRef.current;
              try { const item = id?.startsWith('lib_') ? await fetchLibraryItem(id) : null;
                if (epoch !== sessionGenRef.current) return;
                setCharacterId(id); setLibraryBinding({ character: item ? { id: item.id, revision: item.revision } : null, profile: null, lorebooks: [], expression_asset_id: null });
                const temp = item?.document.profile.settings.temperature; if (typeof temp === 'number') setTemperature(temp);
              } catch (err) { if (epoch === sessionGenRef.current) setError(String(err)); }
            }} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border-subtle)", background: "var(--bg-surface)", color: "var(--text-primary)", fontSize: 12 }}>
              <option value="">（未選択）</option>
              {selectableCharacters.map((c: any) => (
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
              <DebugSection title="互換設定・Loreの採用結果">
                <DebugJson value={{ messages: debugData.compiled?.ordered_messages, lore: debugData.compiled?.sections?.lore, compatibility: debugData.compiled?.sections?.compatibility, binding: debugData.settings.library_binding }} />
              </DebugSection>
              <DebugSection title="Hubの出典・取得記録">
                <DebugJson value={(debugData.compiled?.sections?.portable_snapshot as { document?: { source?: { remote?: unknown } } } | undefined)?.document?.source?.remote} />
              </DebugSection>
              <DebugSection title="🧠 Memory Inspector">
                <MemoryInspector trace={debugData.memory} />
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
  name,
  seed,
  portrait,
  activeCharacter,
  characterId,
  activeWorld,
  intro,
  currentNarrationStyle,
  onSelectNarrationStyle,
  ctxPanel,
  docked,
  onClose,
  onNewSession,
  onClearSession,
  onInjectIntro,
  sessionId,
  memoryRefresh,
  settings,
}: {
  name: string;
  seed: string;
  portrait?: string | null;
  activeCharacter: any;
  characterId: string | null;
  activeWorld: WorldInfo | undefined;
  intro: string;
  currentNarrationStyle: string | null;
  onSelectNarrationStyle: (id: string | null) => void;
  ctxPanel: ReturnType<typeof useContextPanelPref>;
  docked: boolean;
  onClose: () => void;
  onNewSession: () => void;
  onClearSession: () => void;
  onInjectIntro: () => void;
  sessionId: string;
  memoryRefresh: number;
  settings: {
    personaId: string | null; personas: PersonaInfo[]; worldId: string | null; worlds: WorldInfo[];
    systemPrompt: string; setPersonaId: (value: string | null) => void; setWorldId: (value: string | null) => void;
    setSystemPrompt: (value: string) => void; settingsReady: boolean; streaming: boolean;
  };
}) {
  const { personaId, personas, worldId, worlds, systemPrompt, setPersonaId, setWorldId, setSystemPrompt, settingsReady, streaming } = settings;
  return (
    <div className="k-context-panel">
      <div className="k-context-hero">
        {!docked && (
          <IconButton label="パネルを閉じる" size="sm" className="k-context-hero__close" onClick={onClose}>
            <Icon name="close" size={15} />
          </IconButton>
        )}
        <Avatar name={name} seed={seed} size="xl" src={portrait} mascot={!characterId} />
        <div className="k-context-hero__name">{name}</div>
        {activeCharacter?.description ? <p className="k-context-hero__desc">{activeCharacter.description}</p> : !characterId && <p className="k-context-hero__desc">キャラクター未設定のフリートークです。</p>}
        {characterId && (
          <Link to={`/characters/${encodeURIComponent(characterId)}`} className="k-context-hero__link">
            プロフィールを見る <Icon name="chevron" size={13} />
          </Link>
        )}
      </div>

      {activeWorld && (
        <div className="k-context-section">
          <div className="k-context-section__title">✦ シナリオ / ワールド</div>
          <div className="k-context-world">
            <div className="k-context-world__name">{activeWorld.display_name}</div>
            <div className="k-context-world__desc">{activeWorld.description}</div>
          </div>
        </div>
      )}

      {intro && (
        <div className="k-context-section">
          <div className="k-context-section__title">✦ はじまりのシーン</div>
          <div className="k-context-intro">{cleanPreview(intro, 400)}</div>
          <Button variant="ghost" size="sm" onClick={onInjectIntro} style={{ justifySelf: "start" }}>
            <Icon name="play" size={12} /> 会話の最初に流す
          </Button>
        </div>
      )}

      <details className="k-context-section"><summary className="k-context-section__title">会話の設定</summary>
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <label>あなたの人物像<select className="k-input" value={personaId ?? ""} disabled={!settingsReady || streaming} onChange={e => setPersonaId(e.target.value || null)}><option value="">指定なし</option>{personaId && !personas.some(p => p.id === personaId) && <option value={personaId}>以前選んだ人物像（保存版）</option>}{personas.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label>
          <label>舞台<select className="k-input" value={worldId ?? ""} disabled={!settingsReady || streaming} onChange={e => setWorldId(e.target.value || null)}><option value="">指定なし</option>{worldId && !worlds.some(w => w.id === worldId) && <option value={worldId}>以前選んだ舞台（保存版）</option>}{worlds.map(w => <option key={w.id} value={w.id}>{w.display_name}</option>)}</select></label>
          <Link to="/create/settings">人物像・世界観を作る</Link>
        </div>
      </details>
      <StoryControls key={sessionId} value={systemPrompt} onChange={setSystemPrompt} disabled={!settingsReady || streaming} />
      <MemoryPanel key={`${sessionId}:${characterId}:${personaId}`} sessionId={sessionId} refreshKey={memoryRefresh}
        scopeOverride={characterId ? `char:${characterId}|persona:${personaId || 'default'}` : `session:${sessionId}`} />

      <div className="k-context-section">
        <div className="k-context-section__title">✦ ナレーションスタイル</div>
        <div className="k-narration-style-grid">
          <button className={`k-narration-style-chip ${!currentNarrationStyle ? "k-narration-style-chip--active" : ""}`} onClick={() => onSelectNarrationStyle(null)}>
            おまかせ
          </button>
          {NARRATION_STYLES.map((st) => (
            <button key={st.id} className={`k-narration-style-chip ${currentNarrationStyle === st.id ? "k-narration-style-chip--active" : ""}`} onClick={() => onSelectNarrationStyle(st.id)}>
              {st.label}
            </button>
          ))}
        </div>
      </div>

      <div className="k-context-section">
        <div className="k-context-section__title">✦ パネルの表示</div>
        <div className="k-narration-style-grid">
          <button className={`k-narration-style-chip ${ctxPanel.mode === "collapsible" ? "k-narration-style-chip--active" : ""}`} onClick={() => ctxPanel.setMode("collapsible")}>
            必要なときだけ
          </button>
          <button className={`k-narration-style-chip ${ctxPanel.mode === "always" ? "k-narration-style-chip--active" : ""}`} onClick={() => ctxPanel.setMode("always")}>
            常に表示
          </button>
        </div>
        {ctxPanel.mode === "always" && !docked && <div className="k-context-note">画面幅が1280px以上のときに右側へ固定されます。</div>}
      </div>

      <div className="k-context-section" style={{ borderBottom: "none" }}>
        <div className="k-context-section__title">✦ 会話</div>
        <div style={{ display: "grid", gap: 6 }}>
          <Button variant="secondary" size="sm" onClick={onNewSession}>
            <Icon name="plus" size={14} /> 新しいチャット
          </Button>
          <Button variant="danger" size="sm" onClick={onClearSession}>
            <Icon name="trash" size={14} /> この会話を削除
          </Button>
        </div>
      </div>
    </div>
  );
}
