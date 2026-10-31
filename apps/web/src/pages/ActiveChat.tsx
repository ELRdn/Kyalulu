import { connectionScope } from '../lib/remoteStore';
import { chatCompletedAnalytics, chatReopenedAnalytics } from '../lib/analytics';
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  fetchHistory,
  fetchHistoryPage,
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
  type HistoryPage,
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
import ReasoningSummary from '../components/ReasoningSummary';
import KyaluluWaiting, { REPLY_WAIT_LABEL } from '../components/KyaluluWaiting';
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
import { conversationModel, useChatModel } from "../lib/models";
import { useAdultContent } from "../lib/adult";
import { friendlyError } from "../lib/errors";
import MemoryPanel from "../components/MemoryPanel";
import StoryControls from "../components/StoryControls";
import MemoryInspector from "../components/MemoryInspector";
import { useDocumentTitle } from "../lib/title";
import Dialog, { useConfirm } from "../components/ui/Dialog";
import { getReplyVersions, recordReplyVersion, selectReplyVersion, eraseReplyVersions } from "../lib/replyVersions";
import { cleanPreview } from "../lib/text";
import { useMediaQuery } from "../lib/useMediaQuery";
import { NARRATION_STYLES, extractNarrationStyle, applyNarrationStyle } from "../lib/narrationStyle";
import { useChatRecovery } from "../lib/useChatRecovery";
import { useAdministrative, useRuntimeAccess } from "../components/RuntimeGate";
import CloudRouteControls, {defaultCloudRoute,type CloudRouteChoice} from '../components/CloudRouteControls';
import { useCapabilities } from '../lib/capabilities';
import { branchSession, deleteSessionData } from '../lib/api';
import CloudQuoteConfirmation, { useQuoteConfirmation } from '../components/CloudQuoteConfirmation';
import type { CloudQuote } from '../lib/quoteConsent';
import { setGenerationBusy, executionTarget, useLanguage } from '../lib/appContext';
import { AdBanner } from '../components/CreditOptions';
import SessionPolicy from '../components/SessionPolicy';
import ConversationContext from '../components/ConversationContext';
import PortableMedia from '../components/PortableMedia';
import StoryRuntime from '../components/StoryRuntime';
import VisualNovelScene from '../components/VisualNovelScene';
import FirstChatTutorial, { useFirstChatTutorial, type TutorialReceipt } from '../components/FirstChatTutorial';
import type { GenerationProgress } from '../../../../packages/schemas/src';
import type { ClientTimings } from '../lib/clientTimings';
import "./activeChat.css";

type DebugData = {
  session_id: string;
  settings: SessionSettings;
  compiled: CompiledPrompt;
  prompt_source?:'saved_generation'|'current_settings'|'unavailable';
  history_count: number;
  approx_turn: number;
  relationship: string;
  state: Record<string, unknown>;
  generation: GenerationResult | null;
  memory?: MemoryTrace | null;
};

function settingsSnapshot(settings: SessionSettings) {
  return JSON.stringify([settings.session_id, settings.system_prompt, settings.temperature,
    settings.character_id ?? null, settings.persona_id ?? null, settings.world_id ?? null,
    settings.intro ?? "", settings.library_binding ?? null]);
}

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
  const { sessionId = "default" } = useParams<{ sessionId: string }>();
  // A route switch must discard every old UI callback, not just stream callbacks.
  return <ActiveChatSession key={`${connectionScope()}:${sessionId}`} />;
}

function ActiveChatSession() {
  const language = useLanguage(), en = language === 'en';
  const { capabilities, error: capabilitiesError, reload: reloadCapabilities } = useCapabilities();
  const { quote, consent } = useQuoteConfirmation();
  const [lastQuote, setLastQuote] = useState<CloudQuote | null>(null);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [clientTimings, setClientTimings] = useState<ClientTimings | null>(null);
  const [visualNovel, setVisualNovel] = useState(false);
  const [sessionsError, setSessionsError] = useState('');
  const [sessionAction, setSessionAction] = useState(false);
  const sessionActionRef = useRef(false);
  const params = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const sessionId = params.sessionId ?? "default";

  const [researcher, setResearcher] = useResearcherMode();
  const administrative = useAdministrative();
  const ctxPanel = useContextPanelPref();
  const pinned = usePinnedSessions();

  const [baselineModel, setBaselineModel] = useState<string | null>(null);
  const { models, modelId, setModelId, reload: reloadModels, loadFailed: modelsFailed,
    loading: modelsLoading, available: modelAvailable, current: currentModel } = useChatModel({ conversationModel: baselineModel });
  const modelChoices = models.some(m => m.id === modelId) ? models : [
    { id: modelId, display_name: modelId ? (en ? `${modelId} (unavailable)` : `${modelId}（利用できません）`) : (en ? 'Choose a conversation model' : '会話エンジンを選んでください'), provider_type: "", provider_model: "", quantization: "", available: false }, ...models,
  ];
  const [adult] = useAdultContent();
  const [confirmDialog, confirm] = useConfirm();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [messages, setMessages] = useState<(ChatMessage & { id?: number })[]>([]);
  const [historyPage,setHistoryPage]=useState<HistoryPage|null>(null),[historyLoading,setHistoryLoading]=useState(false);
  const historyRequestRef=useRef(0),historyBusyRef=useRef(false);
  const [streaming, setStreaming] = useState(false);
  const {cloud_mode} = useRuntimeAccess();
  const [cloudRoute,setCloudRoute] = useState<CloudRouteChoice>(defaultCloudRoute);
  useEffect(()=>setCloudRoute(defaultCloudRoute),[sessionId,cloud_mode]);
  const [networkOnline, setOnline] = useState(() => navigator.onLine !== false);
  const online = executionTarget() === 'device' || networkOnline;
  const [error, setError] = useState<string | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const editingRef=useRef<number|null>(null);
  editingRef.current=editingIdx;
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
  const savedSettingsRef = useRef<string | null>(null);
  const autoSaveTimer = useRef<number | null>(null);
  const requestEpochRef = useRef(0);
  const sendingRef = useRef(false);
  const mountedRef = useRef(true);
  const [settingsReady, setSettingsReady] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const tutorial = useFirstChatTutorial(settingsReady && historyReady && !historyPage?.previous && !messages.some(message => message.role === 'user'));
  const tutorialRef = useRef<HTMLElement>(null);
  const tutorialButtonRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const memoryRef = useRef<HTMLDivElement>(null);
  const [tutorialFocusRequest, setTutorialFocusRequest] = useState(0);
  const [memoryFocusRequest, setMemoryFocusRequest] = useState(0);
  useEffect(() => {
    if (!tutorialFocusRequest) return;
    const frame = requestAnimationFrame(() => {
      tutorialRef.current?.focus({ preventScroll: true });
      tutorialRef.current?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [tutorialFocusRequest]);
  useEffect(() => {
    if (!memoryFocusRequest) return;
    const frame = requestAnimationFrame(() => {
      memoryRef.current?.focus({ preventScroll: true });
      memoryRef.current?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [memoryFocusRequest]);
  const dismissTutorial = (receipt: TutorialReceipt) => {
    tutorial.dismiss(receipt);
    tutorialButtonRef.current?.focus({ preventScroll: true });
  };
  const stopRef = useRef<(() => void) | null>(null);
  const dispatchedRef = useRef(false);
  const generationIdRef = useRef<string | null>(null);
  const analyticsLoadedSession = useRef<string | null>(null);
  const sessionGenRef = useRef(0);
  const activeSessionRef = useRef(sessionId);
  activeSessionRef.current = sessionId;
  const recovery = useChatRecovery(sessionId, history => {
    requestEpochRef.current += 1;
    stopRef.current?.();
    stopRef.current = null;
    sendingRef.current = false;
    setStreaming(false);
    if(executionTarget()==='device')void loadHistory(sessionId);
    else{setMessages(history.filter(m => m.role !== "system"));setBaselineModel(conversationModel(history));setHistoryReady(true);}
    void loadSessions();
  }, confirm);
  const input = recovery.input;
  const setInput = recovery.change;
  const mutationLocked = streaming || recovery.unresolved || sessionAction;
  useEffect(() => { setGenerationBusy(mutationLocked); return () => setGenerationBusy(false); }, [mutationLocked]);
  const mutationBlocked = () => !mountedRef.current || sendingRef.current || sessionActionRef.current || historyBusyRef.current || recovery.blocked();


  const activeCharacter = characters.find((c: any) => c.id === characterId) as any;
  const activeWorld = worlds.find((w) => w.id === worldId);
  const sessionInfo = sessions.find((s) => s.session_id === sessionId);
  const headerName = portableCharacter?.document.name ?? activeCharacter?.display_name ?? sessionInfo?.character_name ?? sessionTitle({ session_id: sessionId, character_name: null }, language);
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
      setSessionsError('');
    } catch (error) {
      setSessionsError(friendlyError(error).message);
    }
  };

  const loadHistory = async (sid: string,cursor?:HistoryPage['previous']) => {
    const gen = sessionGenRef.current;
    const epoch = requestEpochRef.current;
    const request=++historyRequestRef.current,scope=connectionScope();
    historyBusyRef.current=true;setHistoryLoading(true);
    try {
      const page=executionTarget()==='device'?await fetchHistoryPage(sid,cursor):null;
      const h = page?.history??await fetchHistory(sid);
      if (gen !== sessionGenRef.current || epoch !== requestEpochRef.current || request!==historyRequestRef.current || scope!==connectionScope() || sid !== activeSessionRef.current) return;
      if(editingRef.current!==null)return;
      const filtered = h.filter((x) => x.role !== "system");
      chatReopenedAnalytics(analyticsLoadedSession, sid, filtered.some(message => message.content.trim().length > 0));
      setMessages(filtered);
      setHistoryPage(page);
      setBaselineModel(conversationModel(h));
      setHistoryReady(true);
      setError(null);
    } catch (e) {
      if (gen === sessionGenRef.current&&request===historyRequestRef.current&&scope===connectionScope())setError(friendlyError(e).message);
    } finally {
      if(mountedRef.current&&request===historyRequestRef.current){historyBusyRef.current=false;setHistoryLoading(false);}
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
    if (mutationBlocked()) return;
    const p = presets.find((x) => x.id === pid);
    if (!p) return;
    setSystemPrompt(p.content);
    setTemperature(p.temperature);
    setSettingsStatus(`プリセット「${p.name}」を適用`);
    setTimeout(() => setSettingsStatus((prev) => (prev?.includes(p.name) ? null : prev)), 2000);
  };

  const contentIncludesExplicit = (s: string) => /行為|挿入|絶頂|ベッドで/i.test(s);

  const handleSavePreset = async () => {
    if (mutationBlocked()) return;
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
    if (mutationBlocked()) return;
    const p = presets.find((x) => x.id === pid);
    if (!p || !(await confirm({ title: en ? `Delete preset “${p.name}”?` : `プリセット「${p.name}」を削除しますか？`, confirmLabel: en ? 'Delete' : '削除する', cancelLabel: en ? 'Cancel' : 'キャンセル', danger: true }))) return;
    if (mutationBlocked()) return;
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
    savedSettingsRef.current = null;
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
      savedSettingsRef.current = settingsSnapshot(s);
      settingsLoadedRef.current = true;
      setSettingsReady(true);
    } catch {
      if (gen === sessionGenRef.current) setError("設定の読み込みに失敗しました。再読み込みしてください。");
    }
  };

  const startEdit = (idx: number) => {
    if (mutationBlocked()) return;
    setEditingIdx(idx);
    setEditText(messages[idx]?.content ?? "");
  };
  const cancelEdit = () => {
    setEditingIdx(null);
    setEditText("");
  };
  const saveEdit = async (idx: number) => {
    if (mutationBlocked()) return;
    const msg = messages[idx];
    const newContent = editText.trim();
    if (!newContent) {
      setError("内容が空です");
      return;
    }
    if (msg.id) {
      try {
        await updateHistoryMessage(msg.id, newContent);
        editingRef.current=null;setEditingIdx(null);setEditText("");
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
    if (mutationBlocked()) return;
    const msg = messages[idx];
    if (!(await confirm({ title: en ? 'Delete this message?' : 'このメッセージを削除しますか？', description: <div className="k-confirm__quote">{cleanPreview(msg.content, 80)}</div>, confirmLabel: en ? 'Delete' : '削除する', cancelLabel: en ? 'Cancel' : 'キャンセル', danger: true }))) return;
    if (mutationBlocked()) return;
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
    if (mutationBlocked()) return;
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
    if (mutationBlocked()) return;
    setSettingsSaving(true);
    setSettingsStatus(null);
    try {
      const s: SessionSettings = { session_id: sessionId, system_prompt: systemPrompt, temperature, character_id: characterId, persona_id: personaId, world_id: worldId, intro, library_binding: libraryBinding };
      await saveSettings(s);
      savedSettingsRef.current = settingsSnapshot(s);
      setSettingsStatus("保存しました ✓");
      setTimeout(() => setSettingsStatus(null), 2000);
    } catch (e) {
      setSettingsStatus(String(e));
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleSelectNarrationStyle = (id: string | null) => {
    if (mutationBlocked()) return;
    const next = applyNarrationStyle(systemPrompt, id as any);
    setSystemPrompt(next);
  };

  const loadDebug = async () => {
    if (!administrative) return;
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
    if (quote) { consent.cancel(); return; }
    requestEpochRef.current += 1;
    sendingRef.current = false;
    if (stopRef.current) {
      stopRef.current();
      stopRef.current = null;
    }
    setStreaming(false);
    if (!dispatchedRef.current && generationIdRef.current) {
      recovery.rejected(generationIdRef.current);
      void loadHistory(sessionId);
    } else if (recovery.pending) void recovery.cancel();
    else void loadHistory(sessionId);
  };

  useEffect(() => setShowNsfw(adult), [adult]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

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
    setHistoryPage(null);
    editingRef.current=null;
    setEditingIdx(null);
    setEditText("");
    setDebugData(null);
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
    if (!settingsLoadedRef.current || mutationLocked || historyLoading) return;
    if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
    const settings: SessionSettings = { session_id: sessionId, system_prompt: systemPrompt, temperature, character_id: characterId, persona_id: personaId, world_id: worldId, intro, library_binding: libraryBinding };
    const snapshot = settingsSnapshot(settings);
    if (snapshot === savedSettingsRef.current) return;
    const gen = sessionGenRef.current;
    autoSaveTimer.current = window.setTimeout(async () => {
      if (gen !== sessionGenRef.current || mutationBlocked()) return;
      try {
        await saveSettings(settings);
        if (gen !== sessionGenRef.current) return;
        savedSettingsRef.current = snapshot;
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
  }, [systemPrompt, temperature, characterId, personaId, worldId, intro, sessionId, libraryBinding, mutationLocked, historyLoading]);

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
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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
    if (mutationBlocked()) return;
    if (!(await confirm({ title: en ? `Clear the displayed history with ${headerName}?` : `${headerName}との履歴を削除しますか？`, description: en ? 'This removes the displayed history. Permanently erasing generation results and memories is a separate action.' : '表示される履歴を削除します。生成結果や記憶の完全消去は別の操作です。', confirmLabel: en ? 'Clear history' : '履歴を削除', cancelLabel: en ? 'Cancel' : 'キャンセル', danger: true }))) return;
    if (mutationBlocked()) return;
    try {
      await clearHistory(sessionId);
    } catch (e) {
      setError(String(e));
      return;
    }
    if (!mountedRef.current) return;
    ctxPanel.setOpen(false);
    navigate("/chats");
  };

  const createBranch = async (messageId: number) => {
    if (mutationBlocked() || !capabilities?.features.branch) return;
    if (!(await confirm({ title: en ? 'Branch from this point?' : 'ここまでの会話から分岐しますか？', description: en ? 'Keep the original conversation and create a new one with the settings and state at this point.' : '元の会話を保持し、この時点の設定・状態で新しい会話を作ります。', confirmLabel: en ? 'Create branch' : '分岐を作る', cancelLabel: en ? 'Cancel' : 'キャンセル' })) || mutationBlocked()) return;
    sessionActionRef.current = true; setSessionAction(true);
    try { const result = await branchSession(sessionId, messageId); if (mountedRef.current) navigate(`/chats/${encodeURIComponent(result.session_id)}`); }
    catch (error) { if (mountedRef.current) setError(String(error)); }
    finally { sessionActionRef.current = false; if (mountedRef.current) setSessionAction(false); }
  };
  const permanentlyDelete = async () => {
    if (mutationBlocked() || !capabilities?.features.permanent_delete) return;
    if (!(await confirm({ title: en ? 'Permanently erase conversation data?' : '会話データを完全消去しますか？',
      description: en ? 'Conversation text, generation results and memories linked to this conversation will be permanently erased. Shared memories without an originating conversation are excluded. For conversations you allowed to sync, synced copies with the same conversation ID are included. Conflicting updates require another review; unsent changes on other devices remain device only. Cost ledgers are retained. Backup retention follows the connected service’s policy.' : '会話本文・生成結果・この会話にひも付く記憶を完全消去します。出典がない共有記憶は対象外です。同期を許可した会話は、同じ会話IDの同期コピーも対象です。更新の競合は再確認し、他の端末の未送信変更は端末限定で保持します。費用台帳は残り、バックアップの保持期間は接続先の方針に従います。',
      confirmLabel: en ? 'Erase permanently' : '完全消去する', cancelLabel: en ? 'Cancel' : 'キャンセル', danger: true })) || mutationBlocked()) return;
    const scope = connectionScope(); sessionActionRef.current = true; setSessionAction(true);
    try {
      await deleteSessionData(sessionId);
      if (scope !== connectionScope()) return;
      if (mountedRef.current) { setMessages([]); setHistoryPage(null);setDebugData(null); setVersionTick(value => value + 1); }
      try { recovery.erase(); eraseReplyVersions(sessionId); }
      catch (error) { if (mountedRef.current) setError(`サーバーの会話データは消去しましたが、この端末の下書き・返信履歴の消去を確認できません。${String(error)}`); return; }
      if (mountedRef.current) navigate('/chats');
    }
    catch (error) { if (mountedRef.current) setError(String(error)); }
    finally { sessionActionRef.current = false; if (mountedRef.current) setSessionAction(false); }
  };

  // 同じキャラクター（・ワールド）で、はじまりのシーンから新しく話す
  const handleRestartWithCharacter = async () => {
    if (!characterId) return handleNewSession();
    try {
      const id = await startNewSession({ characterId, personaId, worldId, intro, temperature });
      if (!mountedRef.current) return;
      ctxPanel.setOpen(false);
      navigate(`/chats/${encodeURIComponent(id)}`);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    let active = true;
    setCommands([]);
    if (administrative) fetchCommands().then(value => { if (active) setCommands(value); }).catch(() => {});
    return () => { active = false; };
  }, [administrative]);

  // 「/」で始まる入力はチャットに送らず、API のコマンドとして実行する（履歴には残らない）
  const runSlash = async (text: string) => {
    if (mutationBlocked()) return;
    if (!administrative) {
      setCommandResult({ ok: false, command: text.split(" ")[0], output: "モデルの管理はサーバー側のPCで行ってください", refresh_models: false });
      return;
    }
    setCommandRunning(true);
    setCommandResult({ ok: true, command: text.split(" ")[0], output: "実行中…", refresh_models: false });
    try {
      const result = await runCommand(text);
      if (!mountedRef.current) return;
      setCommandResult(result);
      if (result.refresh_models) reloadModels();
      if (result.ok) recovery.clearCommand(text);
    } catch (e) {
      setCommandResult({ ok: false, command: text.split(" ")[0], output: String(e), refresh_models: false });
    } finally {
      setCommandRunning(false);
    }
  };

  const send = async (regenerateId?: number, request?: string) => {
    if(historyPage?.next)return;
    if (mutationBlocked() || commandRunning || !online) return;
    const submittedDraft = input;
    const text = submittedDraft.trim();
    if (!regenerateId && text.startsWith("/")) {
      if (!commandRunning) void runSlash(text);
      return;
    }
    if ((!text && !regenerateId) || sendingRef.current || !modelAvailable || !settingsReady || !historyReady || !capabilities) return;
    if (regenerateId && !capabilities.features.regenerate) return;
    const previous = messages;
    const next: ChatMessage[] = regenerateId
      ? messages.slice(0, -1)
      : [...messages, { role: "user", content: text }];
    if (next.at(-1)?.role !== "user") return;
    sendingRef.current = true;
    dispatchedRef.current = false; generationIdRef.current = null;
    const epoch = ++requestEpochRef.current;
    const gen = sessionGenRef.current;
    const current = () => epoch === requestEpochRef.current && gen === sessionGenRef.current;
    const replaced = regenerateId ? messages.at(-1)?.content ?? "" : "";
    setError(null);
    setSuggestions(null);
    setStreaming(true);
    setProgress(null);
    setClientTimings(null);
    setLastQuote(null);
    if (!regenerateId) setMessages([...next, { role: "assistant", content: "" }]);
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    try {
      await saveSettings({ session_id: sessionId, system_prompt: systemPrompt, temperature,
          character_id: characterId, persona_id: personaId, world_id: worldId, intro, library_binding: libraryBinding });
    } catch (e) {
      if (current()) {
        setError(`設定保存に失敗したため送信しませんでした: ${String(e)}`);
        setMessages(previous); setStreaming(false); sendingRef.current = false;
      }
      return;
    }
    if (!current()) return;
    const generationId = crypto.randomUUID();
    generationIdRef.current = generationId;
    try {
      recovery.begin(generationId, !!regenerateId, submittedDraft);
    } catch (e) {
      setError(`送信前の保存に失敗しました: ${String(e)}`);
      setMessages(previous); setStreaming(false); sendingRef.current = false;
      return;
    }
    let reply = "";
    const display = (full: string) => {
      if (!current()) return;
      reply = full;
      setMessages([...next, { role: "assistant", content: full }]);
    };
    const submittedCloudRoute = cloudRoute;
    if (cloud_mode) setCloudRoute({...cloudRoute,contributor_training_consent:false});
    stopRef.current = streamChat(modelId, next,
      { session_id: sessionId, generation_id: generationId, temperature, regenerate_message_id: regenerateId, allow_nsfw: showNsfw,
        ...(cloud_mode && capabilities.features.stored_context ? { context_mode: 'stored' as const } : {}),
        ...(cloud_mode && modelId==='cloud-standard' ? submittedCloudRoute : {}),
        // 「注文して作り直す」はこの1回の生成だけに指示を足す（保存される設定は変えない）
        system_prompt: request ? `${systemPrompt.trim()}\n\n# この返事だけの注文\n${request}`.trim() : systemPrompt }, {
        onToken: token => display(reply + token),
        confirmQuote: consent.request,
        onQuote: value => { if (current()) setLastQuote(value); },
        onDispatch: () => { dispatchedRef.current = true; },
        onProgress: value => { if (current()) setProgress(value); },
        onTiming: value => { if (current()) setClientTimings(value); },
        onReset: full => display(full),
        onRejected: () => recovery.rejected(generationId),
        onDone: (full, result) => {
          if (!current()) return;
          chatCompletedAnalytics(result?.status === 'completed' && result.generation_id === generationId && full.trim().length > 0,
            !regenerateId && dispatchedRef.current);
          setMessages([...next, { role: 'assistant', content: full, model_id: modelId,
            reasoning_summary: result?.reasoning_summary, reasoning_summary_status: result?.reasoning_summary_status }]);
          sendingRef.current = false; setStreaming(false); setProgress(null); stopRef.current = null;
          if (regenerateId && replaced && full) {
            recordReplyVersion(sessionId, regenerateId, replaced, full);
            setVersionTick((v) => v + 1);
          }
          void recovery.reconcile();
          if (debugOpen) void loadDebug();
        },
        onError: (e, details) => {
          if (!current()) return;
          sendingRef.current = false; setStreaming(false); setProgress(null); stopRef.current = null;
          setError(e);
          if (details?.rejected) setMessages(previous);
          else void recovery.reconcile();
          if (debugOpen) void loadDebug();
        },
      });
  };

  const lastMsg = messages.at(-1);
  const replyVersions = useMemo(
    () => (!historyPage?.next&&lastMsg?.role === "assistant" && lastMsg.id ? getReplyVersions(sessionId, lastMsg.id) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, lastMsg?.id, versionTick,historyPage?.next],
  );
  const showVersion = async (index: number) => {
    if (mutationBlocked()) return;
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
    if (!modelId || suggesting || !capabilities?.features.suggestions || mutationBlocked()) return;
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

  const friendly = error ? friendlyError(error, language) : null;
  const knownSessions = sessions.filter((s) => s.count > 0 || s.session_id === "default" || s.session_id === sessionId);
  const railNeedle = railQuery.trim().toLowerCase();
  const railSessions = railNeedle ? knownSessions.filter((s) => `${sessionTitle(s, 'ja')} ${sessionTitle(s, 'en')} ${cleanPreview(s.last_preview, 300)}`.toLowerCase().includes(railNeedle)) : knownSessions;
  const railPinned = railSessions.filter((s) => pinned.includes(s.session_id));
  const railRecent = railSessions.filter((s) => !pinned.includes(s.session_id));
  const worldNameOf = (id?: string | null) => worlds.find((w) => w.id === id)?.display_name;
  const canRegenerate = !!capabilities?.features.regenerate && !mutationLocked && !historyLoading && !historyPage?.next && messages.at(-1)?.role === "assistant" && !!messages.at(-1)?.id && messages.at(-2)?.role === "user";
  const chatStatus = !online ? (en ? 'Waiting for connection' : '接続待ち') : quote ? (en ? 'Waiting for storage and training consent' : '保存・学習利用への同意待ち') : streaming ? (en ? 'Waiting for a reply…' : REPLY_WAIT_LABEL) : recovery.unresolved ? (en ? 'Checking the send result…' : '送信結果を確認中…')
    : settingsReady && historyReady && modelAvailable ? (en ? 'Ready to chat' : '会話の準備完了') : (en ? 'Preparing conversation…' : '会話を準備中…');
  const starters = hasCharacter
    ? (en ? ['Hello! Nice to meet you.', 'How was your day?', 'Tell me more about yourself.', '*sits down quietly beside you*'] : ["こんにちは！はじめまして", "今日はどんな一日だった？", "きみのこと、もっと教えて", "*そっと隣に座る*"])
    : (en ? ['Hello!', 'What would you like to talk about?', 'Let’s make a story together.'] : ["こんにちは！", "おすすめの話題はある？", "物語をいっしょに作ろう"]);

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
      memoryRef={memoryRef}
      settings={{ personaId, personas, worldId, worlds, systemPrompt, setPersonaId, setWorldId, setSystemPrompt, settingsReady, streaming: mutationLocked }}
      extras={<>
        {capabilities?.features.summaries && <ConversationContext key={sessionId} sessionId={sessionId} refreshKey={messages.length + (streaming ? 1 : 0)} disabled={mutationLocked} visible={panelDocked||ctxPanel.open} />}
        {capabilities?.features.story_rules && <StoryRuntime key={sessionId} sessionId={sessionId} refreshKey={messages.length + (streaming ? 1 : 0)} visible={panelDocked||ctxPanel.open} />}
        {portableCharacter && capabilities?.features.media_playback && <PortableMedia assets={portableCharacter.document.assets} />}
        <div className="k-context-section"><Button size="sm" variant="danger" disabled={mutationLocked || !capabilities?.features.permanent_delete} onClick={() => void permanentlyDelete()}>{en ? 'Erase conversation data' : '会話データを完全消去'}</Button>
          <p className="k-context-note">{capabilities?.features.permanent_delete ? (en ? 'Erases text, generation results and related memories. This is separate from clearing only the displayed history.' : '本文・生成結果・関連記憶を消去します。履歴のみの削除とは別の操作です。') : (en ? 'Permanent erasure is unavailable on this connection.' : 'この接続先では完全消去に対応していません。')}</p></div>
      </>}
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
          <h2 id="k-directive-title" className="k-confirm__title">{en ? 'How should this reply change?' : 'どんな返事にしたい？'}</h2>
          <p className="k-confirm__desc">{en ? 'Regenerate the current reply using this direction. The direction applies only to this one attempt.' : 'いまの返事を、この注文に沿って作り直します。注文はこの1回だけに使われます。'}</p>
          <Textarea value={directive} onChange={(e) => setDirective(e.target.value)} rows={3} maxLength={300} placeholder={en ? 'e.g. more shy / advance the story / shorter' : '例：もっと照れた感じで / 話を少し進めて / 短めに'} data-autofocus />
          <div className="k-directive-presets">
            {(en ? ['Sweeter', 'Shorter', 'Advance the story', 'More shy', 'Describe the scene'] : ["もっと甘く", "もっと短く", "話を進めて", "照れた感じで", "情景をくわしく"]).map((t) => (
              <button key={t} type="button" className="k-chip" onClick={() => setDirective(t)}>{t}</button>
            ))}
          </div>
          <div className="k-confirm__actions">
            <Button variant="ghost" type="button" onClick={() => setDirectiveOpen(false)}>{en ? 'Cancel' : 'やめる'}</Button>
            <Button variant="primary" type="submit" disabled={!directive.trim()}>
              <Icon name="wand" size={15} /> {en ? 'Regenerate' : '作り直す'}
            </Button>
          </div>
        </form>
      </Dialog>
      {/* 左: セッションレール */}
      <aside className="k-chat-rail" aria-label={en ? 'Conversations' : '会話リスト'}>
        <div className="k-chat-rail__head">
          <Button variant="primary" onClick={handleNewSession} className="k-chat-rail__new">
            <Icon name="plus" size={16} /> {en ? 'New chat' : '新しいチャット'}
          </Button>
          <div className="k-chat-rail__search">
            <Icon name="search" size={15} />
            <input value={railQuery} onChange={(e) => setRailQuery(e.target.value)} placeholder={en ? 'Search chats…' : 'チャットを検索…'} aria-label={en ? 'Search chats' : 'チャットを検索'} />
          </div>
        </div>
        <div className="k-chat-rail__list">
          {sessionsError ? <p role="alert">{sessionsError}<Button size="sm" variant="ghost" onClick={() => void loadSessions()}>{en ? 'Retry' : '再読込'}</Button></p> : railSessions.length === 0 && <EmptyState motif="✧" title={railNeedle ? (en ? 'No results' : '見つかりませんでした') : (en ? 'No chats yet' : 'チャットがありません')} />}
          {railGroup(en ? 'Pinned' : 'ピン留め', railPinned)}
          {railGroup(en ? 'Recent chats' : '最近のチャット', railRecent)}
        </div>
      </aside>

      {/* 中央: 会話 */}
      <div className="k-chat-main">
        <AdBanner/>
        <SessionPolicy sessionId={sessionId} model={currentModel?.display_name??modelId??''} disabled={mutationLocked}/>
        <div className="k-chat-header">
          <Link to="/chats" className="k-chat-header__back" aria-label={en ? 'Back to chats' : 'チャット一覧へ戻る'}>
            <Icon name="back" size={18} />
          </Link>
          <button type="button" className="k-chat-header__who" onClick={() => ctxPanel.setOpen(!ctxPanel.open)} aria-label={en ? `Show information for ${headerName}` : `${headerName}の情報を表示`}>
            <span className="k-chat-header__avatar">
              <Avatar name={headerName} seed={characterId ?? sessionId} size="md" src={portrait} mascot={!hasCharacter} />
              <span className="k-chat-header__status" aria-hidden="true" />
            </span>
            <span className="k-chat-header__identity">
              <span className="k-chat-header__name" title={headerName}>{headerName}</span>
              <span className="k-chat-header__sub">{activeWorld ? `✦ ${activeWorld.display_name} · ` : ""}{chatStatus}</span>
            </span>
          </button>
          <div className="k-chat-header__actions">
            <button ref={tutorialButtonRef} type="button" aria-label={en ? 'First chat guide' : '初トークの案内'} title={en ? 'First chat guide' : '初トークの案内'}
              className={`k-icon-btn ${tutorial.open ? 'k-icon-btn--active' : ''}`} aria-expanded={tutorial.open}
              onClick={() => { tutorial.reopen(); setTutorialFocusRequest(value => value + 1); }}>?</button>
            <Button size="sm" variant="ghost" aria-pressed={visualNovel} onClick={() => setVisualNovel(value => !value)}>{visualNovel ? (en ? 'Show chat history' : '会話履歴を表示') : (en ? 'Visual novel' : 'VN表示')}</Button>
            <IconButton label={en ? 'Character & preset' : 'キャラ・プリセット'} active={portableOpen} onClick={() => setPortableOpen((v) => !v)}>
              <Icon name="book" size={17} />
            </IconButton>
            {researcher && (
              <IconButton label={en ? 'Advanced settings (Studio)' : '詳細設定（Studio）'} active={studioOpen} onClick={() => setStudioOpen((v) => !v)}>
                <Icon name="settings" size={17} />
              </IconButton>
            )}
            {researcher && (
              <IconButton label={en ? 'Debug (Ctrl+Shift+D)' : 'デバッグ (Ctrl+Shift+D)'} active={debugOpen} onClick={() => setDebugOpen((v) => !v)}>
                <Icon name="bug" size={17} />
              </IconButton>
            )}
            {!panelDocked && (
              <IconButton label={ctxPanel.open ? (en ? 'Close information panel' : '情報パネルを閉じる') : (en ? 'Open information panel' : '情報パネルを開く')} active={ctxPanel.open} onClick={() => ctxPanel.setOpen(!ctxPanel.open)}>
                <Icon name="panel" size={17} />
              </IconButton>
            )}
          </div>
        </div>

        <div ref={listRef} className="k-chat-messages" aria-busy={historyLoading}>
          {historyPage&&!streaming&&!recovery.unresolved&&<nav aria-label={en?'Conversation history':'会話の履歴'} aria-busy={historyLoading} className="k-chat-history-nav">
            <span>{historyPage.total?`${historyPage.start+1}–${historyPage.end} / ${historyPage.total}`:(en?'No saved messages':'保存済みの発言なし')}</span>
            <Button size="sm" variant="ghost" disabled={historyLoading||mutationLocked||editingIdx!==null||!historyPage.previous} onClick={()=>void loadHistory(sessionId,historyPage.previous)}>{en?'Earlier':'前へ'}</Button>
            <Button size="sm" variant="ghost" disabled={historyLoading||mutationLocked||editingIdx!==null||!historyPage.next} onClick={()=>void loadHistory(sessionId,historyPage.next)}>{en?'Later':'次へ'}</Button>
            <Button size="sm" variant="ghost" disabled={historyLoading||mutationLocked||editingIdx!==null} onClick={()=>void loadHistory(sessionId)}>{en?'Latest':'最新'}</Button>
            {historyPage.next&&<span role="status">{en?'Return to latest before sending. Your draft is kept.':'送信するには「最新」へ戻ってね。下書きは保持されます。'}</span>}
          </nav>}
          {historyLoading&&<p role="status" className="k-context-note">{en?'Loading saved history…':'保存済みの履歴を読み込んでいます…'}</p>}
          {tutorial.open && <FirstChatTutorial step={tutorial.step} cloud={!!cloud_mode} device={executionTarget() === 'device'} language={language} inspectorAvailable={administrative}
            storageFailed={tutorial.storageFailed} panelRef={tutorialRef} onNext={tutorial.next} onBack={tutorial.back}
            onSkip={() => dismissTutorial('skipped')} onComplete={() => dismissTutorial('completed')}
            onFocusComposer={() => composerRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()}
            onOpenModels={() => setPortableOpen(true)}
            onOpenMemory={() => { ctxPanel.setOpen(true); setMemoryFocusRequest(value => value + 1); }}
            onOpenInspector={() => { if (administrative) { setResearcher(true); setDebugOpen(true); } }} />}
          {visualNovel && <VisualNovelScene name={headerName} messages={messages} streaming={streaming} cloud={cloud_mode} assets={capabilities?.features.media_playback ? portableCharacter?.document.assets ?? [] : []} />}
          <div className="k-chat-messages__inner" hidden={visualNovel}>
            {messages.length === 0 && settingsReady && historyReady && !historyLoading && (
              <div className="k-chat-welcome">
                <div className="k-chat-welcome__art">
                  <Avatar name={headerName} seed={characterId ?? sessionId} size="xl" src={portrait} mascot={!hasCharacter} />
                </div>
                <h2 className="k-chat-welcome__title">{hasCharacter ? (en ? `Chat with ${headerName}` : `${headerName}と話してみよう`) : (en ? 'What shall we talk about?' : 'なにを話そうか？')}</h2>
                <p className="k-chat-welcome__desc">
                  {hasCharacter ? (en ? 'Send your first message. Your conversation is saved automatically.' : '最初のひとことを送ってみて。会話は自動で保存されるよ。') : (en ? 'Choose a character to start a conversation in their style.' : 'キャラクターを選ぶと、その子らしい会話ができるよ。')}
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
                    <Icon name="compass" size={15} /> {en ? 'Explore characters' : 'キャラクターを探す'}
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
                    {isAssistant && !isEditing && !isStreaming && <ReasoningSummary message={m} cloud={cloud_mode || m.model_id?.startsWith('cloud-')} />}
                    {isEditing ? (
                      <div className="k-msg__editor">
                        <Textarea aria-label={en ? 'Message text' : 'メッセージ本文'} value={editText} onChange={(e) => setEditText(e.target.value)} rows={Math.max(3, editText.split("\n").length)} autoFocus />
                        <div className="k-msg__editor-actions">
                          <Button variant="ghost" size="sm" onClick={cancelEdit}>{en ? 'Cancel' : 'キャンセル'}</Button>
                          <Button variant="primary" size="sm" onClick={() => saveEdit(i)}>{en ? 'Save' : '保存'}</Button>
                        </div>
                      </div>
                    ) : role === "user" ? (
                      <div className="k-bubble k-bubble--user">{m.content}</div>
                    ) : (
                      <MessageContent content={m.content} isStreaming={isStreaming} />
                    )}
                    {!isEditing && !isStreaming && !mutationLocked && (
                      <div className="k-msg__actions">
                        {isAssistant && i === messages.length - 1 && replyVersions && (
                          <span className="k-msg__versions" role="group" aria-label={en ? 'Switch reply versions' : '返事の案を切り替える'}>
                            <button type="button" className="k-msg__action k-msg__action--icon" onClick={() => void showVersion(replyVersions.index - 1)} disabled={replyVersions.index <= 0} aria-label={en ? 'Previous version' : '前の案'}>
                              <Icon name="back" size={14} />
                            </button>
                            <span className="k-msg__versions-count" aria-live="polite">
                              {replyVersions.index + 1}/{replyVersions.versions.length}
                            </span>
                            <button type="button" className="k-msg__action k-msg__action--icon" onClick={() => void showVersion(replyVersions.index + 1)} disabled={replyVersions.index >= replyVersions.versions.length - 1} aria-label={en ? 'Next version' : '次の案'}>
                              <Icon name="chevron" size={14} />
                            </button>
                          </span>
                        )}
                        {isAssistant && i === messages.length - 1 && canRegenerate && (
                          <>
                            <button type="button" className="k-msg__action" onClick={() => void send(messages.at(-1)!.id)} disabled={!settingsReady}>
                              <Icon name="refresh" size={14} /> {en ? 'Another reply' : '別の返事'}
                            </button>
                            <button type="button" className="k-msg__action" onClick={() => setDirectiveOpen(true)} disabled={!settingsReady}>
                              <Icon name="wand" size={14} /> {en ? 'Regenerate with direction' : '注文して作り直す'}
                            </button>
                          </>
                        )}
                        {m.id && <button type="button" className="k-msg__action" disabled={!capabilities?.features.branch} title={capabilities?.features.branch ? (en ? 'Create a separate conversation from this state' : 'ここまでの状態で別の会話を作る') : (en ? 'Branching is unavailable on this connection' : 'この接続先は分岐に対応していません')} onClick={() => void createBranch(m.id!)}>{en ? 'Branch here' : 'ここから分岐'}</button>}
                        <button type="button" className="k-msg__action" onClick={() => startEdit(i)} aria-label={en ? 'Edit' : '編集'}>
                          <Icon name="edit" size={14} /> {en ? 'Edit' : '編集'}
                        </button>
                        <button type="button" className="k-msg__action k-msg__action--danger" onClick={() => handleDelete(i)} aria-label={en ? 'Delete' : '削除'}>
                          <Icon name="trash" size={14} /> {en ? 'Delete' : '削除'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
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
            <button type="button" onClick={() => setError(null)} aria-label={en ? 'Dismiss error' : 'エラーを閉じる'}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}

        {historyReady && !modelsLoading && !modelAvailable && (
          <div className="k-chat-recovery" role="status">
            <span>{modelsFailed ? (en ? 'Could not load conversation models.' : '会話エンジンを取得できませんでした。') : modelId ? (en ? `Model “${modelId}” is unavailable. No other model will be selected automatically.` : `会話エンジン「${modelId}」を利用できません。別のモデルへ自動では切り替えません。`) : (en ? 'Choose a conversation model before sending.' : '会話エンジンを選んでから送信してね。')}</span>
            <button type="button" onClick={() => setPortableOpen(true)}>{en ? 'Choose a model' : '会話エンジンを選ぶ'}</button>
            <button type="button" onClick={reloadModels}>{en ? 'Reload' : '再読込'}</button>
          </div>
        )}
        {(recovery.unresolved || recovery.notice) && (!streaming || recovery.storageError) && (
          <div className="k-chat-recovery" role="status" aria-live="polite">
            <span>{recovery.storageError ?? recovery.notice ?? (en ? 'Checking the send result. Wait before sending again or changing the conversation.' : '送信結果を確認しています。確認中は新しい送信・会話の変更を待ってね。')}</span>
            {recovery.pending && <button type="button" disabled={recovery.checking} onClick={() => void recovery.reconcile()}>
              {recovery.checking ? (en ? 'Checking…' : '確認中…') : (en ? 'Check result' : '結果を確認')}
            </button>}
            {recovery.pending && !streaming && <button type="button" onClick={() => void recovery.cancel()}>{en ? 'Stop and check' : '停止して確認'}</button>}
          </div>
        )}
        <div ref={composerRef} className="k-chat-composer-wrap">
          {tutorial.storageFailed && !tutorial.open && <p role="status" className="k-context-note">{en ? 'This browser could not record guide completion or skipping. The guide may appear again next time.' : '案内の完了・スキップをこのブラウザーに記録できませんでした。次回また案内が出る場合があります。'}</p>}
          {capabilitiesError && <div className="k-chat-error" role="alert">{capabilitiesError}<Button variant="ghost" size="sm" onClick={reloadCapabilities}>{en ? 'Reload capabilities' : '機能情報を再読込'}</Button></div>}
          {capabilities && !capabilities.features.regenerate && <p className="k-context-note">{en ? 'Reply regeneration is unavailable on this connection.' : 'この接続先では返事の再生成に対応していません。'}</p>}
          {quote && <CloudQuoteConfirmation quote={quote} onAccept={() => consent.accept()} onCancel={() => consent.cancel()}
            onProviderTrainingConsentChange={checked => consent.acknowledgeProviderTraining(quote.quote_id, checked)} />}
          {lastQuote && !quote && <p className="k-context-note" aria-label={en ? 'Current destination and credit cap' : '今回の送信先と消費上限'}>
            {en ? 'Current: ' : '今回：'}{lastQuote.route.display_name} · {lastQuote.route.upstream || lastQuote.route.provider}
            {lastQuote.route.upstream && (en ? ` (via ${lastQuote.route.provider})` : `（${lastQuote.route.provider}経由）`)} · {en ? 'Cap' : '上限'} {lastQuote.max_credits.toLocaleString()} K-Credits{en ? ' (no reservation; actual cost settled after completion)' : '（予約なし・完了後に実費精算）'}
          </p>}
          {streaming && !quote && <KyaluluWaiting progress={progress} researcher={researcher} language={language} />}
          {clientTimings && debugOpen && <details className="k-context-section"><summary>今回の待ち時間</summary>
            <dl>{([['文脈取得', clientTimings.context_fetch_ms], ['見積取得', clientTimings.quote_fetch_ms], ['同意待ち', clientTimings.quote_consent_ms], ['送信から最初の本文通知', clientTimings.post_to_first_body_ms], ['送信から全文完了通知', clientTimings.post_to_full_ms]] as const).map(([label, value]) => value !== null && <div key={label}><dt>{label}</dt><dd>{(value / 1000).toFixed(2)}秒</dd></div>)}</dl>
            <p className="k-context-note">本文通知は画面への引き渡し時刻です。Cloudで保存後に一括表示する場合は、最初の本文と全文完了が同時になります。</p>
          </details>}
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
              <button type="button" className="k-cmd-result__close" onClick={() => setCommandResult(null)} aria-label={en ? 'Dismiss result' : '結果を閉じる'}>
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
                disabled={!capabilities?.features.suggestions || !modelId || !settingsReady || mutationLocked || suggesting || !messages.some((m) => m.role === "assistant")}
                aria-pressed={!!suggestions}
                title={capabilities?.features.suggestions ? (en ? 'Suggest possible replies to send next' : '次に送る返事の候補を出す') : (en ? 'Reply suggestions are unavailable on this connection' : 'この接続先では返事の候補に対応していません')}
              >
                <Icon name="sparkle" size={13} className={suggesting ? "k-spin" : undefined} /> {suggesting ? (en ? 'Thinking…' : '考え中…') : (en ? 'Reply suggestions' : '返事の候補')}
              </button>
            }
            value={input}
            onChange={setInput}
            onSend={() => void send()}
            onStop={handleStop}
            streaming={streaming}
            sendBlocked={!capabilities || sessionAction || recovery.unresolved || historyLoading || !!historyPage?.next || commandRunning || !online || (!modelAvailable && !input.trim().startsWith("/"))}
            disabled={!settingsReady || !historyReady}
            disabledText={!modelId ? (modelsFailed ? (en ? 'Cannot connect to the server. Check that the app is running.' : 'サーバーに接続できません。アプリの起動状態を確認してね') : (en ? 'Preparing the conversation model…' : '会話エンジンを準備中…')) : (en ? 'Preparing conversation…' : '会話を準備中…')}
            placeholder={hasCharacter ? (en ? `Write a message to ${headerName}…` : `${headerName}への言葉を入力してね…`) : (en ? 'Write your message…' : 'きみの言葉を入力してね…')}
          />
        </div>
      </div>

      {/* 右: ContextPanel */}
      {panelDocked ? (
        <div className="k-chat-context-wrap">{contextPanel}</div>
      ) : (
        <Sheet open={ctxPanel.open} onClose={() => ctxPanel.setOpen(false)} side="right" width="min(340px, 100vw)" topOffset={64} label={en ? 'Conversation information' : '会話の情報'}>
          {contextPanel}
        </Sheet>
      )}

      <Sheet open={portableOpen} onClose={() => setPortableOpen(false)} side="right" topOffset={64} label={en ? 'Character & preset' : 'キャラ・プリセット'}>
        <div className="k-sheet-head">
          <div className="k-sheet-head__title">{en ? 'Character & preset' : 'キャラ・プリセット'}</div>
          <IconButton label={en ? 'Close' : '閉じる'} size="sm" onClick={() => setPortableOpen(false)}>
            <Icon name="close" size={15} />
          </IconButton>
        </div>
        <div style={{ flex: 1, minHeight: 0, padding: 18, overflowY: "auto", overscrollBehavior: "contain" }}>
          <fieldset className="k-chat-mutation-group" disabled={mutationLocked || !settingsReady} style={{ display: "grid", gap: 18 }}>
            <div className="k-chat-model-choice" style={{ display: "grid", gap: 8 }}>会話エンジン
              <ModelSelector models={modelChoices} value={modelId} onChange={setModelId} disabled={!capabilities}
                loading={modelsLoading} error={modelsFailed ? '会話エンジン一覧の取得に失敗しました。再読込してください。' : ''} />
              <Button variant="ghost" onClick={reloadModels}>モデルを再読込</Button>
            </div>
            {capabilities?.model_selection==='cloud-routes'&&<CloudRouteControls key={sessionId} currentModel={currentModel} value={cloudRoute} onChange={setCloudRoute} disabled={mutationLocked || !settingsReady}/>}
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
        <fieldset disabled={mutationLocked} className="k-chat-mutation-group" style={{ flex: 1, overflowY: "auto", padding: 14, display: "grid", gap: 14, alignContent: "start" }}>
          <label style={{ fontSize: 11, display: "flex", gap: 6, alignItems: "center", color: showNsfw ? "var(--error-text)" : "var(--text-muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={showNsfw} onChange={(e) => setShowNsfw(e.target.checked)} /> 🔞 NSFWを表示（キャラ/プリセット/シナリオ）
          </label>

          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)" }}>モデル</label>
            <ModelSelector models={modelChoices} value={modelId} onChange={setModelId} disabled={!capabilities}
              loading={modelsLoading} error={modelsFailed ? '会話エンジン一覧の取得に失敗しました。再読込してください。' : ''} />
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
        </fieldset>
      </Sheet>

      {/* Debug: Researcherのみ Ctrl+Shift+D で開くデバッグドロワー */}
      <Sheet open={researcher && debugOpen} onClose={() => setDebugOpen(false)} side="right" width="min(480px, 94vw)" topOffset={60} label={en ? 'Debug panel' : 'デバッグパネル'}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>🐞 {en ? 'Debug' : 'デバッグ'} <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 400, marginLeft: 6 }}>Ctrl+Shift+D</span></div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{sessionId}</div>
          </div>
          <IconButton label={en ? 'Close' : '閉じる'} onClick={() => setDebugOpen(false)}>×</IconButton>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "grid", gap: 14, alignContent: "start" }}>
          {debugLoading && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{en ? 'Loading…' : '読込中…'}</div>}
          {debugError && <div style={{ fontSize: 12, color: "var(--error-text)" }}>{en ? 'Could not load debug information.' : debugError}</div>}
          {debugData && (
            <>
              <DebugSection title={debugData.prompt_source==='current_settings'?(en?'📝 Current settings preview':'📝 現在の設定のプレビュー'):(en ? '📝 Raw prompt' : '📝 生プロンプト (raw prompt)')}>
                <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 10, lineHeight: 1.6, background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: 10, maxHeight: 220, overflowY: "auto", color: "var(--text-primary)", margin: 0 }}>
                  {debugData.prompt_source==='unavailable'?(en?'The original generation prompt is not saved on this device.':'元の生成プロンプトは、この端末には保存されていません。'):(debugData.generation?.raw_prompt || debugData.compiled?.system_prompt || (en ? '(none)' : '(なし)'))}
                </pre>
              </DebugSection>
              <DebugSection title={en ? 'Compatibility settings / Lore selection' : '互換設定・Loreの採用結果'}>
                <DebugJson value={{ messages: debugData.compiled?.ordered_messages, lore: debugData.compiled?.sections?.lore, compatibility: debugData.compiled?.sections?.compatibility, binding: debugData.settings.library_binding }} />
              </DebugSection>
              <DebugSection title={en ? 'Hub sources and retrieval history' : 'Hubの出典・取得記録'}>
                <DebugJson value={(debugData.compiled?.sections?.portable_snapshot as { document?: { source?: { remote?: unknown } } } | undefined)?.document?.source?.remote} />
              </DebugSection>
              <DebugSection title="🧠 Memory Inspector">
                <MemoryInspector trace={debugData.memory} />
              </DebugSection>
              <DebugSection title={en ? '🔢 Estimated token breakdown' : '🔢 推定トークン内訳'}>
                <DebugJson value={debugData.generation?.token_budget ?? { estimated: true, compiler_tokens: debugData.compiled?.token_estimate }} />
              </DebugSection>
              <DebugSection title={en ? '💾 Persisted state (state)' : '💾 永続化された状態 (state)'}>
                <DebugJson value={debugData.state} />
              </DebugSection>
              <DebugSection title={en ? '📡 Telemetry' : '📡 テレメトリ'}>
                <DebugJson value={debugData.generation?.telemetry} />
              </DebugSection>
              <DebugSection title={en ? '⚙ Generation settings (generation_config)' : '⚙ 生成設定 (generation_config)'}>
                  <div>{en ? 'requested: requested settings / applied: applied settings / unsupported: unsupported settings' : 'requested: 要求 / applied: 適用 / unsupported: 未対応'}</div>
                <DebugJson value={debugData.generation?.generation_config} />
              </DebugSection>
              <DebugSection title={en ? '✅ Validation log (validation)' : '✅ 検証ログ (validation)'}>
                <DebugJson value={debugData.generation?.validation} />
                <details><summary>{en ? 'Outputs and errors by attempt' : '試行ごとの出力・エラー'}</summary><DebugJson value={debugData.generation?.attempts} /></details>
              </DebugSection>
            </>
          )}
        </div>
      </Sheet>
    </div>
  );
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
  memoryRef,
  settings,
  extras,
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
  memoryRef: React.Ref<HTMLDivElement>;
  extras: React.ReactNode;
  settings: {
    personaId: string | null; personas: PersonaInfo[]; worldId: string | null; worlds: WorldInfo[];
    systemPrompt: string; setPersonaId: (value: string | null) => void; setWorldId: (value: string | null) => void;
    setSystemPrompt: (value: string) => void; settingsReady: boolean; streaming: boolean;
  };
}) {
  const { personaId, personas, worldId, worlds, systemPrompt, setPersonaId, setWorldId, setSystemPrompt, settingsReady, streaming } = settings;
  const en = useLanguage() === 'en';
  const [memoryOpen,setMemoryOpen]=useState(false),[memorySeen,setMemorySeen]=useState(false);
  return (
    <div className="k-context-panel">
      <div className="k-context-hero">
        {!docked && (
          <IconButton label={en ? 'Close panel' : 'パネルを閉じる'} size="sm" className="k-context-hero__close" onClick={onClose}>
            <Icon name="close" size={15} />
          </IconButton>
        )}
        <Avatar name={name} seed={seed} size="xl" src={portrait} mascot={!characterId} />
        <div className="k-context-hero__name">{name}</div>
        {activeCharacter?.description ? <p className="k-context-hero__desc">{activeCharacter.description}</p> : !characterId && <p className="k-context-hero__desc">{en ? 'Free chat without a selected character.' : 'キャラクター未設定のフリートークです。'}</p>}
        {characterId && (
          <Link to={`/characters/${encodeURIComponent(characterId)}`} className="k-context-hero__link">
            {en ? 'View profile' : 'プロフィールを見る'} <Icon name="chevron" size={13} />
          </Link>
        )}
      </div>

      {activeWorld && (
        <div className="k-context-section">
          <div className="k-context-section__title">✦ {en ? 'Scenario / World' : 'シナリオ / ワールド'}</div>
          <div className="k-context-world">
            <div className="k-context-world__name">{activeWorld.display_name}</div>
            <div className="k-context-world__desc">{activeWorld.description}</div>
          </div>
        </div>
      )}

      {intro && (
        <div className="k-context-section">
          <div className="k-context-section__title">✦ {en ? 'Opening scene' : 'はじまりのシーン'}</div>
          <div className="k-context-intro">{cleanPreview(intro, 400)}</div>
          <Button variant="ghost" size="sm" onClick={onInjectIntro} disabled={streaming} style={{ justifySelf: "start" }}>
            <Icon name="play" size={12} /> {en ? 'Insert at the start of the conversation' : '会話の最初に流す'}
          </Button>
        </div>
      )}

      <details className="k-context-section"><summary className="k-context-section__title">{en ? 'Conversation settings' : '会話の設定'}</summary>
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <label>{en ? 'Your persona' : 'あなたの人物像'}<select className="k-input" value={personaId ?? ""} disabled={!settingsReady || streaming} onChange={e => setPersonaId(e.target.value || null)}><option value="">{en ? 'None' : '指定なし'}</option>{personaId && !personas.some(p => p.id === personaId) && <option value={personaId}>{en ? 'Previously selected persona (saved version)' : '以前選んだ人物像（保存版）'}</option>}{personas.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label>
          <label>{en ? 'Setting' : '舞台'}<select className="k-input" value={worldId ?? ""} disabled={!settingsReady || streaming} onChange={e => setWorldId(e.target.value || null)}><option value="">{en ? 'None' : '指定なし'}</option>{worldId && !worlds.some(w => w.id === worldId) && <option value={worldId}>{en ? 'Previously selected setting (saved version)' : '以前選んだ舞台（保存版）'}</option>}{worlds.map(w => <option key={w.id} value={w.id}>{w.display_name}</option>)}</select></label>
          <Link to="/create/settings">{en ? 'Create personas and worlds' : '人物像・世界観を作る'}</Link>
        </div>
      </details>
      <StoryControls key={sessionId} value={systemPrompt} onChange={setSystemPrompt} disabled={!settingsReady || streaming} />
      <div ref={memoryRef} tabIndex={-1} aria-label={en ? 'Memories' : '覚えていること'} onFocus={event=>{if(event.target===event.currentTarget){setMemoryOpen(true);setMemorySeen(true);}}}>
      <details className="k-context-section" open={memoryOpen} onToggle={event=>{if(event.target===event.currentTarget){setMemoryOpen(event.currentTarget.open);if(event.currentTarget.open)setMemorySeen(true);}}}>
      <summary className="k-context-section__title">{en?'Memories':'覚えていること'}</summary>
      <fieldset className="k-chat-mutation-group" disabled={streaming}>
      {memorySeen&&<MemoryPanel key={`${sessionId}:${characterId}:${personaId}`} sessionId={sessionId} refreshKey={memoryRefresh} visible={memoryOpen&&(docked||ctxPanel.open)} />}
      </fieldset>
      </details>
      </div>
      {extras}

      <div className="k-context-section">
        <div className="k-context-section__title">✦ {en ? 'Narration style' : 'ナレーションスタイル'}</div>
        <div className="k-narration-style-grid">
          <button className={`k-narration-style-chip ${!currentNarrationStyle ? "k-narration-style-chip--active" : ""}`} onClick={() => onSelectNarrationStyle(null)} disabled={streaming}>
            {en ? 'Default' : 'おまかせ'}
          </button>
          {NARRATION_STYLES.map((st) => (
            <button key={st.id} className={`k-narration-style-chip ${currentNarrationStyle === st.id ? "k-narration-style-chip--active" : ""}`} onClick={() => onSelectNarrationStyle(st.id)} disabled={streaming}>
              {en ? st.englishLabel : st.label}
            </button>
          ))}
        </div>
      </div>

      <div className="k-context-section">
        <div className="k-context-section__title">✦ {en ? 'Panel display' : 'パネルの表示'}</div>
        <div className="k-narration-style-grid">
          <button className={`k-narration-style-chip ${ctxPanel.mode === "collapsible" ? "k-narration-style-chip--active" : ""}`} onClick={() => ctxPanel.setMode("collapsible")}>
            {en ? 'When needed' : '必要なときだけ'}
          </button>
          <button className={`k-narration-style-chip ${ctxPanel.mode === "always" ? "k-narration-style-chip--active" : ""}`} onClick={() => ctxPanel.setMode("always")}>
            {en ? 'Always visible' : '常に表示'}
          </button>
        </div>
        {ctxPanel.mode === "always" && !docked && <div className="k-context-note">{en ? 'Docked on the right when the viewport is at least 1280 px wide.' : '画面幅が1280px以上のときに右側へ固定されます。'}</div>}
      </div>

      <div className="k-context-section" style={{ borderBottom: "none" }}>
        <div className="k-context-section__title">✦ {en ? 'Conversation' : '会話'}</div>
        <div style={{ display: "grid", gap: 6 }}>
          <Button variant="secondary" size="sm" onClick={onNewSession}>
            <Icon name="plus" size={14} /> {en ? 'New chat' : '新しいチャット'}
          </Button>
          <Button variant="danger" size="sm" onClick={onClearSession} disabled={streaming}>
            <Icon name="trash" size={14} /> {en ? 'Clear displayed history' : '表示履歴を削除'}
          </Button>
        </div>
      </div>
    </div>
  );
}
