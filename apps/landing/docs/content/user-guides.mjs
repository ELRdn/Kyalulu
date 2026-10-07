// Curated against public ELRdn/Kyalulu commit eea271beb3eef9211f8b588db331daf2761ba3e2.
// Source snapshot verified 2026-10-05. Public implementation is not release acceptance.
// Authored static HTML only; the docs renderer resolves {{doc:slug}} links.
export default [
  {
    slug: 'quickstart',
    group: 'start',
    icon: 'rocket',
    title: { ja: 'はじめてのKyalulu', en: 'Getting started with Kyalulu' },
    description: {
      ja: '公開ソースからAPIとWebを起動し、Mock Echoで確認してから推論エンジンを接続します。',
      en: 'Run the API and web app from public source, check the setup with Mock Echo, then connect an inference engine.',
    },
    keywords: {
      ja: ['導入', '起動', 'クイックスタート', 'uv', 'pnpm', 'Mock Echo', 'Desktop'],
      en: ['setup', 'quickstart', 'uv', 'pnpm', 'Mock Echo', 'desktop', 'development'],
    },
    readingMinutes: 9,
    sources: ['README.md', 'pyproject.toml', 'runtime/pyproject.toml', '.env.example', 'docs/ROADMAP.md', 'models/example-le.yaml'],
    sections: {
      ja: [
        {
          id: 'before-you-start',
          title: '用意するもの',
          html: `<p>Kyaluluはキャラクター、会話、記憶を管理するアプリです。文章を生成するモデルは別の推論エンジンで動かします。まずはモデル不要のMock Echoで画面と保存を確認し、その後にエンジンを接続すると、起動の問題とモデルの問題を切り分けられます。</p>
<ul><li>Python 3.11以上、uv 0.12以上。</li><li>Node.js 20以上、pnpm 10以上。公開workspaceの指定はpnpm 10.30.1です。</li><li>Gitと、依存パッケージを取得できるネットワーク。</li></ul>
<aside class="callout"><p>この手順は2026年10月5日に確認した公開コミットを基にした<strong>ソースからの開発起動</strong>です。npm配布版やCloudサービスの公開・動作保証を示すものではありません。公開資料は<a href="https://github.com/ELRdn/Kyalulu/tree/eea271beb3eef9211f8b588db331daf2761ba3e2">確認済みのソースツリー</a>で参照できます。今後のmainでは手順が変わる可能性があります。</p></aside>`,
        },
        {
          id: 'clone-and-configure',
          title: 'ソースを取得し、環境を設定する',
          html: `<p>以下はWindowsのPowerShell用です。保存先は任意ですが、以降のコマンドはすべて取得したリポジトリの直下で実行してください。既存環境に上書きせず、新しい作業フォルダーで始めると安心です。</p>
<pre><code>git clone https://github.com/ELRdn/Kyalulu.git
cd Kyalulu
Copy-Item .env.example .env</code></pre>
<p>macOS／Linuxでは最後の行を<code>cp .env.example .env</code>に置き換えます。作成した<code>.env</code>をテキストエディターで開き、最初は次の外部接続・汎用エイリアスを空にしてください。公開のサンプルには特定の接続先やモデル名が入っており、そのまま自分の設定になるとは限りません。</p>
<pre><code>OPENAI_COMPATIBLE_URL=
OPENAI_COMPATIBLE_API_KEY=
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=</code></pre>
<p>Mock Echoの送信には外部APIキーもモデルのダウンロードも不要です。OllamaやLM StudioのローカルURLは既定値を残せます。後で接続先を変更したらAPIを再起動します。キー入りの<code>.env</code>を共有しないでください。接続先を選ぶ前に<a href="{{doc:privacy}}">データとプライバシー</a>も確認しましょう。</p>`,
        },
        {
          id: 'install-dependencies',
          title: 'workspaceの依存関係を導入する',
          html: `<pre><code>uv sync --frozen --all-packages --no-install-workspace
pnpm install --frozen-lockfile</code></pre>
<p>Python側はルートの<code>pyproject.toml</code>が<code>runtime</code>をworkspaceメンバーとして指定しています。<code>--all-packages</code>でruntimeの依存関係も対象にし、<code>--no-install-workspace</code>でルートなどのworkspaceパッケージ自体のインストールを省きます。APIのPythonソースは次の起動コマンドで明示的に参照します。仮想環境はルートの<code>.venv</code>です。</p>
<aside class="callout warning"><p>古いREADMEの<code>uv sync --directory runtime</code>だけを使う手順はここでは採用しません。現行の公開workspaceでは、ルートをPythonパッケージとしてビルドしようとして失敗する場合があります。起動時も追加の同期を避けるため、作成済みのPythonを直接使います。</p></aside>
<p><code>--frozen</code>は公開lockfileを使う指定です。依存解決に失敗したら、まずPython／uvの版、取得したソースとlockfile、ネットワークを確認してください。Windowsでuvキャッシュの権限エラーが出た場合は、そのシェルで<code>$env:UV_CACHE_DIR = "$PWD/.uv-cache"</code>を指定して再実行できます。通常チャットの初回起動にdev／remoteの追加依存は必要ありません。</p>`,
        },
        {
          id: 'run-api-and-web',
          title: 'APIとWebを別々のターミナルで起動する',
          html: `<h3>ターミナルA：API</h3>
<pre><code>.venv/Scripts/python.exe -m uvicorn python.api.main:app --app-dir runtime --host 127.0.0.1 --port 8000</code></pre>
<p>macOS／Linuxでは<code>.venv/Scripts/python.exe</code>を<code>.venv/bin/python</code>に置き換えます。<code>--app-dir runtime</code>で<code>python.api.main</code>を読み込めるようにします。ターミナルを開いたままにし、APIは同じ保存先に対して1プロセスで運用してください。</p>
<h3>ターミナルB：Web</h3>
<p>別のターミナルで同じリポジトリ直下へ移動してから実行します。</p>
<pre><code>pnpm dev</code></pre>
<p>ブラウザーで<code>http://localhost:5173</code>を開きます。Webは<code>/api</code>への通信を8000番のAPIへ中継します。画面だけ表示されて接続できない場合は、ターミナルAのエラーを確認してください。ポートが使用中なら既存プロセスを確認し、二重起動を避けます。Webを独自のポートへ変える場合、Hub取得用にはAPI側の<code>KYALULU_TRUSTED_ORIGINS</code>にも正確なOriginが必要です。</p>`,
        },
        {
          id: 'check-with-mock',
          title: 'Mock Echoで最初の会話を確認する',
          html: `<ol><li>新しい会話を開き、モデルとして<strong>Mock Echo</strong>を明示的に選びます。</li><li>「こんにちは。これは起動確認です」と送信します。</li><li>入力を反映したダミーの返事が表示され、履歴が残ることを確認します。</li><li>別の画面へ移動して会話を開き直し、必要なら再読み込みして履歴を確認します。</li></ol>
<p>期待する結果は、画面・API・保存がつながり、送信した内容に対応する返事が見えることです。Mockの文章はキャラクター品質や実モデルの速度の評価には使えません。モデル一覧が空ならAPIの起動ログとYAMLレジストリ同期を確認し、一覧にモデルがあっても準備完了とは考えないでください。</p>
<p>接続診断はStatusから確認できます。APIの<code>GET /api/models</code>と<code>GET /api/providers/health</code>も切り分けに使えます。まずこの段階が安定してから、<a href="{{doc:characters}}">キャラクターの取り込み</a>へ進むと設定を確認しやすくなります。</p>`,
        },
        {
          id: 'connect-engine-and-desktop',
          title: '推論エンジンと任意のDesktopを使う',
          html: `<p>実際の生成を使う準備ができたら、LE、LM Studio、Ollama、またはOpenAI互換APIを選びます。ローカルモデルはエンジン側で用意・起動し、モデルIDと接続状態を確認してからKyaluluで選択します。LEの既定接続先は<code>127.0.0.1:8130</code>です。LEが配信するモデルは<code>le:&lt;モデルID&gt;</code>として現れるため、通常は追加YAMLが不要です。詳しい設定は<a href="{{doc:models}}">モデルと接続先</a>を参照してください。</p>
<p>Desktopの開発シェルを使う場合は、依存導入後に別のターミナルから起動できます。</p>
<pre><code>pnpm dev:desktop</code></pre>
<p>Desktopは既存APIがあれば利用し、なければcheckoutのPython環境を使って起動を監督します。LEの自動起動は別途バイナリー指定が必要です。公開資料ではPython／LE同梱の配布版検証が未完了なので、このコマンドを完成したインストーラーの代わりとは扱いません。使い方は<a href="{{doc:memory}}">記憶</a>や<a href="{{doc:worlds}}">人物像と世界観</a>へ、全体の入口は<a href="{{doc:index}}">ドキュメント一覧</a>へ進めます。</p>`,
        },
      ],
      en: [
        {
          id: 'before-you-start',
          title: 'What you need',
          html: `<p>Kyalulu manages characters, conversations, and memory. Models generate text through a separate inference engine. Start with Mock Echo, which needs no model, to check the interface and persistence. Connecting an engine afterward makes it easier to distinguish setup problems from model problems.</p>
<ul><li>Python 3.11 or later and uv 0.12 or later.</li><li>Node.js 20 or later and pnpm 10 or later. The public workspace specifies pnpm 10.30.1.</li><li>Git and network access to download dependencies.</li></ul>
<aside class="callout"><p>This guide describes a <strong>development setup from source</strong>, based on the public commit verified on October 5, 2026. It does not establish the availability or readiness of an npm distribution or Cloud service. See the <a href="https://github.com/ELRdn/Kyalulu/tree/eea271beb3eef9211f8b588db331daf2761ba3e2">verified source tree</a> for the public materials. Future changes to main may require different steps.</p></aside>`,
        },
        {
          id: 'clone-and-configure',
          title: 'Get the source and configure the environment',
          html: `<p>The commands below use PowerShell on Windows. Choose any suitable destination, then run all subsequent commands from the cloned repository root. A new directory helps avoid overwriting an existing setup.</p>
<pre><code>git clone https://github.com/ELRdn/Kyalulu.git
cd Kyalulu
Copy-Item .env.example .env</code></pre>
<p>On macOS or Linux, replace the last line with <code>cp .env.example .env</code>. Open the new <code>.env</code> in a text editor and initially clear these external connection settings and generic aliases. The public example contains specific endpoints and a model name; they may not match your setup.</p>
<pre><code>OPENAI_COMPATIBLE_URL=
OPENAI_COMPATIBLE_API_KEY=
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=</code></pre>
<p>Sending a message through Mock Echo requires neither an external API key nor a model download. You can leave the default local URLs for Ollama and LM Studio in place. Restart the API after changing connection settings later. Do not share a <code>.env</code> containing keys. Read <a href="{{doc:privacy}}">Data and privacy</a> before choosing an endpoint.</p>`,
        },
        {
          id: 'install-dependencies',
          title: 'Install workspace dependencies',
          html: `<pre><code>uv sync --frozen --all-packages --no-install-workspace
pnpm install --frozen-lockfile</code></pre>
<p>The root <code>pyproject.toml</code> declares <code>runtime</code> as a uv workspace member. <code>--all-packages</code> includes the runtime dependencies, while <code>--no-install-workspace</code> skips installation of the workspace packages themselves, including the root package. The startup command below explicitly locates the API source. The virtual environment lives in <code>.venv</code> at the repository root.</p>
<aside class="callout warning"><p>This guide replaces the older README instruction that uses only <code>uv sync --directory runtime</code>. With the current public workspace, that approach can try to build the root as a Python package and fail. Startup also uses the existing Python executable directly to avoid another synchronization.</p></aside>
<p><code>--frozen</code> uses the public lockfile. If installation fails, check your Python and uv versions, the source and lockfile you downloaded, and network access first. For a Windows uv cache permission error, set <code>$env:UV_CACHE_DIR = "$PWD/.uv-cache"</code> in that shell and retry. The dev and remote extras are not required for the initial chat setup.</p>`,
        },
        {
          id: 'run-api-and-web',
          title: 'Run the API and web app in separate terminals',
          html: `<h3>Terminal A: API</h3>
<pre><code>.venv/Scripts/python.exe -m uvicorn python.api.main:app --app-dir runtime --host 127.0.0.1 --port 8000</code></pre>
<p>On macOS or Linux, replace <code>.venv/Scripts/python.exe</code> with <code>.venv/bin/python</code>. <code>--app-dir runtime</code> makes <code>python.api.main</code> importable. Leave this terminal open. Run only one API process against the same data directory.</p>
<h3>Terminal B: web app</h3>
<p>Open another terminal, navigate to the same repository root, and run:</p>
<pre><code>pnpm dev</code></pre>
<p>Open <code>http://localhost:5173</code> in your browser. The web app proxies <code>/api</code> requests to the API on port 8000. If the page loads but cannot connect, inspect errors in Terminal A. If a port is occupied, check the existing process and avoid starting a duplicate. When using a custom web port, Hub fetching also requires the exact web origin in the API's <code>KYALULU_TRUSTED_ORIGINS</code> setting.</p>`,
        },
        {
          id: 'check-with-mock',
          title: 'Check your first conversation with Mock Echo',
          html: `<ol><li>Open a new conversation and explicitly select <strong>Mock Echo</strong> as the model.</li><li>Send “Hello. This is a setup check.”</li><li>Check that a dummy reply reflecting your input appears and the history is saved.</li><li>Navigate away and reopen the conversation; reload if needed to check persistence.</li></ol>
<p>The expected result is a working connection between the interface, API, and storage, with a reply corresponding to your input. Mock output cannot establish character quality or real-model speed. If the model list is empty, inspect API startup and YAML registry synchronization. A listed model does not necessarily mean it is ready to generate.</p>
<p>Use Status for connection diagnostics. The API's <code>GET /api/models</code> and <code>GET /api/providers/health</code> endpoints can also help identify the problem. Once this stage works reliably, continue to <a href="{{doc:characters}}">Importing and editing characters</a>.</p>`,
        },
        {
          id: 'connect-engine-and-desktop',
          title: 'Connect an engine and optionally use Desktop',
          html: `<p>When you are ready to use actual generation, choose LE, LM Studio, Ollama, or an OpenAI-compatible API. For a local model, prepare and start it in the engine, check its model ID and connection status, then select it in Kyalulu. LE connects to <code>127.0.0.1:8130</code> by default. Its served models appear as <code>le:&lt;model ID&gt;</code>, so an additional YAML file is usually unnecessary. See <a href="{{doc:models}}">Models and connections</a> for configuration details.</p>
<p>To use the Desktop development shell, run this in another terminal after installing dependencies:</p>
<pre><code>pnpm dev:desktop</code></pre>
<p>Desktop uses an existing API when available; otherwise it supervises startup using the checkout's Python environment. Automatic LE startup needs a separately specified binary. Public materials report incomplete validation of a distribution bundling Python and LE, so this command should not be treated as a finished installer. Continue with <a href="{{doc:memory}}">Memory</a> or <a href="{{doc:worlds}}">Personas and worlds</a>, or return to the <a href="{{doc:index}}">documentation index</a>.</p>`,
        },
      ],
    },
  },
  {
    slug: 'models',
    group: 'start',
    icon: 'cpu',
    title: { ja: 'モデルと接続先', en: 'Models and connections' },
    description: {
      ja: 'LEのモデルID、直接接続のYAML、ローカルと外部APIの違いを確認します。',
      en: 'Understand LE model IDs, YAML configuration for direct providers, and local versus external inference.',
    },
    keywords: {
      ja: ['モデル', 'LE', 'LM Studio', 'Ollama', 'OpenAI互換', 'YAML', '接続診断'],
      en: ['models', 'LE', 'LM Studio', 'Ollama', 'OpenAI compatible', 'YAML', 'providers'],
    },
    readingMinutes: 7,
    sources: ['README.md', '.env.example', 'models/example-le.yaml', 'models/example-lmstudio.yaml', 'models/example-ollama.yaml', 'models/example-openai.yaml', 'docs/ROADMAP.md'],
    sections: {
      ja: [
        {
          id: 'choose-a-provider',
          title: 'アプリの保存とモデルの実行を分ける',
          html: `<p>Kyaluluが持つのはキャラクター、人物像、世界観、会話状態、記憶などの保存データです。返事の計算は選んだProviderが担当します。LEを経由してもキャラクターの正本がLEへ移るわけではありません。モデルを変更すると文体や設定への従い方は変わりますが、モデルの登録だけで重みの準備や品質検証が済むこともありません。</p>
<table><thead><tr><th>接続方法</th><th>準備するもの</th></tr></thead><tbody><tr><td>Mock Echo</td><td>起動確認用。外部API・モデル不要。</td></tr><tr><td>LE</td><td>別プロセスのdaemonと、LE側で使えるモデル。</td></tr><tr><td>LM Studio／Ollama直結</td><td>ローカルサーバー、モデル、対応するYAML。</td></tr><tr><td>OpenAI互換</td><td>接続先のベースURL、必要なキー、対応モデルID。</td></tr></tbody></table>
<p>初めてなら<a href="{{doc:quickstart}}">導入手順</a>のMock確認を先に終えましょう。外部サーバーを選ぶ場合、保存場所がローカルでも生成用の情報は送信されます。送信範囲は<a href="{{doc:privacy}}">プライバシー</a>で確認できます。</p>`,
        },
        {
          id: 'use-le-models',
          title: 'LEのモデル一覧から選ぶ',
          html: `<ol><li>LEの<code>le-daemon</code>を起動し、<code>LE_API_URL</code>の接続先を確認します。既定は<code>http://127.0.0.1:8130</code>です。</li><li>Kyalulu APIに<code>LE_API_TOKEN</code>を設定するか、LEが作成したトークンファイルを読み取れる状態にします。Windowsの既定ファイルは<code>%LOCALAPPDATA%/kyalulu-le/api-token</code>です。</li><li>Statusの診断、またはチャット欄の<code>/le status</code>と<code>/le models</code>で状態とIDを確認します。</li><li>配信中のモデルをKyaluluの一覧から選びます。</li></ol>
<p>LE内部のIDが<code>ollama/qwen3.5:9b</code>なら、Kyaluluの自動登録IDは<code>le:ollama/qwen3.5:9b</code>です。この例はIDの形を示すもので、モデルが自動インストールされるという意味ではありません。自動列挙にはYAML不要です。明示的に設定を残す場合の<code>example-le.yaml</code>では、<code>provider.type: le</code>と<code>provider.model: ollama/qwen3.5:9b</code>を使い、後者に<code>le:</code>を付けません。</p>
<p>GGUFのロード操作は<code>/le load &lt;id&gt;</code>、アンロードは<code>/le unload [id]</code>です。操作結果は会話履歴へ保存されません。ロードには時間とRAM／VRAMが必要で、一覧に載るだけでは生成可能とは限りません。トークンはAPI側が保持し、ブラウザーには渡しません。</p>`,
        },
        {
          id: 'configure-direct-providers',
          title: 'LM Studio・Ollamaを直接接続する',
          html: `<p>LEを使わず直接接続する場合は、<code>models/example-lmstudio.yaml</code>または<code>models/example-ollama.yaml</code>を別名でコピーし、独自の<code>id</code>と実際のモデル名に変更します。次は公開Ollama例の基本構成です。</p>
<pre><code>id: my-qwen2-local
display_name: "My local Qwen2"
provider:
  type: ollama
  model: qwen2:7b
context_length: 8192
recommended_generation:
  temperature: 0.8
  top_p: 0.9</code></pre>
<p><code>id</code>はKyalulu内の識別子、<code>provider.model</code>はエンジンが受け付ける名前です。Ollama側に同じモデルを用意し、<code>.env</code>の<code>OLLAMA_URL</code>を確認します。LM Studioの場合は<code>provider.type: lm_studio</code>にし、サーバーでロードしたモデルのIDと<code>LM_STUDIO_URL</code>を合わせます。既定URLはそれぞれ<code>http://127.0.0.1:11434</code>、<code>http://127.0.0.1:1234/v1</code>です。</p>
<p>APIを再起動するとYAMLがDBへ同期されます。モデル定義はYAMLが正本で、SQLiteはキャッシュです。文脈長や量子化の記載は実機性能の保証ではなく、モデルやロード設定と整合させる必要があります。変更後は診断を確認し、利用する段階で短い会話から試してください。</p>`,
        },
        {
          id: 'configure-compatible-api',
          title: 'OpenAI互換APIと互換性の限界',
          html: `<p><code>models/example-openai.yaml</code>は<code>provider.type: openai_compatible</code>の例です。コピーした定義でモデルIDを接続先の実際のIDに合わせ、<code>.env</code>へベースURLとキーを設定します。</p>
<pre><code>OPENAI_COMPATIBLE_URL=https://api.openai.com/v1
OPENAI_COMPATIBLE_API_KEY=YOUR_API_KEY
LLM_BASE_URL=
LLM_API_KEY=</code></pre>
<p>これは公開設定にあるURLの形の例で、特定モデルの利用資格や動作確認を保証しません。URLの末尾に<code>/chat/completions</code>を追加しないでください。<code>LLM_BASE_URL</code>や<code>LLM_API_KEY</code>が設定されていると対応する汎用エイリアスが優先されるため、意図しない接続を避けるには両方を確認します。</p>
<aside class="callout warning"><p>「OpenAI互換」は全機能の互換保証ではありません。サンプラー、構造化出力、ストリームの動作はサーバーとモデルで異なります。Kyaluluが必要とする返事と状態更新を生成できるかは別途確認が必要です。公開資料でも3ローカルモデルの正式比較や長期品質評価は未完了です。</p></aside>
<p>認証失敗はURLとキー、モデル不明はProvider側のID、遅延やロード失敗はエンジンとメモリー量を先に確認します。キャラクター設定を調整するときは<a href="{{doc:characters}}">キャラクター記事</a>へ、その他の手順は<a href="{{doc:index}}">一覧</a>へ戻れます。</p>`,
        },
      ],
      en: [
        {
          id: 'choose-a-provider',
          title: 'Separate stored data from model execution',
          html: `<p>Kyalulu owns stored characters, personas, worlds, conversation state, and memory. The selected provider performs generation. Routing through LE does not transfer ownership of the character's canonical data to LE. Changing models can change writing style and instruction following, but registering a model does not prepare its weights or establish its quality.</p>
<table><thead><tr><th>Connection</th><th>What to prepare</th></tr></thead><tbody><tr><td>Mock Echo</td><td>A setup check; no external API or model required.</td></tr><tr><td>LE</td><td>A separate daemon and a model available through LE.</td></tr><tr><td>Direct LM Studio / Ollama</td><td>A local server, a model, and a matching YAML definition.</td></tr><tr><td>OpenAI-compatible API</td><td>A base URL, any required key, and a supported model ID.</td></tr></tbody></table>
<p>For your first setup, complete the Mock check in <a href="{{doc:quickstart}}">Getting started</a>. With an external server, generation inputs are transmitted even if your saved data stays local. See <a href="{{doc:privacy}}">Data and privacy</a> for the distinction.</p>`,
        },
        {
          id: 'use-le-models',
          title: 'Choose a model served by LE',
          html: `<ol><li>Start LE's <code>le-daemon</code> and check <code>LE_API_URL</code>. The default is <code>http://127.0.0.1:8130</code>.</li><li>Set <code>LE_API_TOKEN</code> for the Kyalulu API, or make LE's generated token file readable. Its default Windows location is <code>%LOCALAPPDATA%/kyalulu-le/api-token</code>.</li><li>Use Status diagnostics, or <code>/le status</code> and <code>/le models</code> in the chat composer, to check readiness and IDs.</li><li>Select a served model from Kyalulu's model list.</li></ol>
<p>If LE's internal ID is <code>ollama/qwen3.5:9b</code>, Kyalulu exposes it automatically as <code>le:ollama/qwen3.5:9b</code>. This illustrates the ID format; it does not mean the model is installed automatically. Automatic discovery needs no YAML. For an explicit definition, <code>example-le.yaml</code> uses <code>provider.type: le</code> and <code>provider.model: ollama/qwen3.5:9b</code>, without the <code>le:</code> prefix in the latter.</p>
<p>Use <code>/le load &lt;id&gt;</code> to load a GGUF and <code>/le unload [id]</code> to unload it. Command results are not stored as conversation messages. Loading needs time and RAM or VRAM; being listed does not establish readiness to generate. The API holds the token and does not pass it to the browser.</p>`,
        },
        {
          id: 'configure-direct-providers',
          title: 'Connect directly to LM Studio or Ollama',
          html: `<p>For direct connections without LE, copy <code>models/example-lmstudio.yaml</code> or <code>models/example-ollama.yaml</code> to a new filename. Give it a unique <code>id</code> and the actual model name. This is a basic configuration derived from the public Ollama example:</p>
<pre><code>id: my-qwen2-local
display_name: "My local Qwen2"
provider:
  type: ollama
  model: qwen2:7b
context_length: 8192
recommended_generation:
  temperature: 0.8
  top_p: 0.9</code></pre>
<p><code>id</code> identifies the model within Kyalulu; <code>provider.model</code> is the name accepted by the engine. Prepare that model in Ollama and check <code>OLLAMA_URL</code> in <code>.env</code>. For LM Studio, use <code>provider.type: lm_studio</code> and match the loaded server model ID and <code>LM_STUDIO_URL</code>. The default URLs are <code>http://127.0.0.1:11434</code> and <code>http://127.0.0.1:1234/v1</code>, respectively.</p>
<p>Restarting the API synchronizes YAML definitions to the database. YAML is the source of truth for these model definitions; SQLite is a cache. Context length and quantization metadata do not guarantee performance and must match the model and loading configuration. Check diagnostics after changes, then start with a short conversation when you are ready to generate.</p>`,
        },
        {
          id: 'configure-compatible-api',
          title: 'Configure an OpenAI-compatible API and understand its limits',
          html: `<p><code>models/example-openai.yaml</code> demonstrates <code>provider.type: openai_compatible</code>. Copy it, match the model ID to the actual provider, and set the base URL and key in <code>.env</code>:</p>
<pre><code>OPENAI_COMPATIBLE_URL=https://api.openai.com/v1
OPENAI_COMPATIBLE_API_KEY=YOUR_API_KEY
LLM_BASE_URL=
LLM_API_KEY=</code></pre>
<p>This illustrates a URL from the public configuration, not entitlement to or verified operation of a particular model. Do not append <code>/chat/completions</code> to the URL. When set, <code>LLM_BASE_URL</code> and <code>LLM_API_KEY</code> take precedence as generic aliases, so inspect both sets of variables to avoid routing to an unintended endpoint.</p>
<aside class="callout warning"><p>“OpenAI-compatible” does not guarantee compatibility with every feature. Sampling parameters, structured output, and streaming vary by server and model. Check separately whether the model can produce the reply and state update Kyalulu requires. Public materials also report incomplete formal comparison of three local models and incomplete long-term quality evaluation.</p></aside>
<p>For authentication errors, check the URL and key; for an unknown model, check the provider's ID; for loading failures or delays, check the engine and available memory first. Continue to <a href="{{doc:characters}}">Characters</a> when adjusting character settings, or return to the <a href="{{doc:index}}">index</a>.</p>`,
        },
      ],
    },
  },
  {
    slug: 'characters',
    group: 'use',
    icon: 'sparkles',
    title: { ja: 'キャラクターを取り込み、育てる', en: 'Importing and editing characters' },
    description: {
      ja: 'カードや貼り付けから取り込み、原本と保存版を守りながら設定・挨拶・Loreを整えます。',
      en: 'Import cards or pasted settings, then refine greetings and Lore while keeping originals and saved revisions.',
    },
    keywords: {
      ja: ['キャラクター', 'Create', 'カード', 'CCv3', 'CHARX', 'Lorebook', 'インポート', '版'],
      en: ['characters', 'Create', 'character cards', 'CCv3', 'CHARX', 'Lorebook', 'import', 'revisions'],
    },
    readingMinutes: 6,
    sources: ['README.md', 'docs/COMPATIBILITY.md', 'docs/COMPATIBILITY_ACCEPTANCE.md', 'docs/HUB_ACCEPTANCE.md'],
    sections: {
      ja: [
        {
          id: 'import-and-preview',
          title: '保存する前に内容を確認する',
          html: `<p>キャラクターは話し相手の名前、性格、文体、挨拶、会話例などをまとめた設定です。モデルそのものとは別なので、同じキャラを別の<a href="{{doc:models}}">モデル</a>で使えます。モデルにより表現や指示への従い方が変わるため、取り込み成功だけで元のアプリと同じ振る舞いになるとは限りません。</p>
<ol><li>Createでカードファイルを選ぶか、設定を貼り付けます。CCv1／v2／v3のJSON・カード入りPNG、CHARXなどを扱えます。</li><li>プレビューで名前、挨拶、画像、設定、取り込む履歴、変換の制限を確認します。</li><li>同名の項目があっても、自動上書きとは考えず、新規作成か明示的な更新かを選びます。</li><li>保存後に「キャラを開く」から挨拶を選び、会話を始めます。</li></ol>
<p>HubはDiscoverから詳細と取り込み内容を確認して進みます。URLを入力しただけでは保存されません。取り込んだキャラが公式キャラに変わることもありません。作者・出典・個別ライセンスを確認して、自分に許可された範囲で利用してください。</p>`,
        },
        {
          id: 'write-clear-character-settings',
          title: '性格と会話例を具体的にする',
          html: `<p>初めての設定は、短い人物紹介、話し方のルール、自然に返せる挨拶、数行の会話例から始めると確認しやすくなります。Character.AI形式の手動貼り付けでは<code>Name</code>が必須です。<code>Definition</code>を最後に置き、以降を設定本文にします。次は架空の図書館案内人の例です。</p>
<pre><code>Name: リオ
Description: 静かな図書館で本を探す案内人
Greeting: ようこそ。今日はどんな物語を探している？
Definition: 日本語で落ち着いて話す。知らない本の内容は断定しない。
{{user}}: 冒険ものを読みたい。
{{char}}: 旅をする話と、謎を解く話ならどちらが好き？</code></pre>
<p>編集画面では挨拶、文体、シナリオ、会話例、Lore、画像、生成設定を整えられます。「親切」のような抽象語だけでなく、質問の仕方や返事の長さを例にすると意図が伝わりやすくなります。人物像や舞台を分けて用意したい場合は<a href="{{doc:worlds}}">人物像と世界観</a>へ進んでください。</p>`,
        },
        {
          id: 'understand-lore-and-compatibility',
          title: 'Loreと移行時の制限を理解する',
          html: `<p>Lorebookは、会話に必要になった固有名詞や世界の知識を補う設定です。たとえば「北の書庫」をキーワードにして、「古い航海記録を保管する部屋」と短く定義できます。全部を毎回入れるのではなく、採用条件と推定予算に従って選びます。何が使われたかはResearcher Debugで確認できます。</p>
<aside class="callout warning"><p>元アプリのスクリプト、動的な変数操作、独自HTML、高度なテンプレートがそのまま実行されるわけではありません。未対応の項目は保持のみ、または理由を示して無効化されます。保存されていることと生成に適用されることを区別してください。</p></aside>
<p>SillyTavernの設定、BYAFのシナリオ、Risuの共通カード拡張などにも対応範囲の差があります。Character.AIは手動貼り付け／JSONを使い、アカウントや全履歴の自動取得には対応しません。外部アプリでの往復受け入れは未完了なので、移行後の設定・画像・会話例を確認しましょう。画像URLの扱いとHubへの通信は<a href="{{doc:privacy}}">プライバシー記事</a>で説明しています。</p>`,
        },
        {
          id: 'keep-revisions-and-export',
          title: '保存版を使い、用途に合う形式で書き出す',
          html: `<p>原本と編集した版は別に保存されます。既存の会話は選んだキャラ・プリセット・Loreの版を使い続け、編集した最新版へ自動では切り替わりません。たとえば挨拶だけ変えても進行中の会話が無断で置き換わることはありません。適用したいときは会話側で版を確認して明示的に切り替えます。</p>
<ul><li>CCv2／v3 JSON・PNG：対応アプリへカードを移す用途。V3固有項目や追加画像の差を確認します。</li><li>CCv3 CHARX：カードと埋め込み画像をまとめる用途。</li><li>Kyaluluバックアップ：編集結果、設定、選択した履歴、画像をKyalulu内で復元する用途。</li><li>原本：取り込んだバイト列を取得し、未対応の要素も残す用途。</li></ul>
<p>カード形式だけでは会話履歴やKyaluluの全設定を表現できません。書き出し前の欠落説明を確認し、移行先で開いて内容を確かめてください。取り込んだ過去の履歴から、成功した生成記録や記憶が自動で作られることもありません。記憶は<a href="{{doc:memory}}">別の機能</a>として管理します。その他のガイドは<a href="{{doc:index}}">一覧</a>から選べます。</p>`,
        },
      ],
      en: [
        {
          id: 'import-and-preview',
          title: 'Review the content before saving',
          html: `<p>A character defines the person you talk to: their name, personality, writing style, greetings, and dialogue examples. It is separate from the model, so the same character can be used with different <a href="{{doc:models}}">models</a>. Expression and instruction following vary by model; a successful import does not guarantee identical behavior to the original app.</p>
<ol><li>In Create, select a card file or paste settings. Supported formats include CCv1/v2/v3 JSON, PNG files containing card metadata, and CHARX.</li><li>Review the name, greetings, images, settings, selected history, and conversion limits in the preview.</li><li>If an item has the same name, choose a new import or an explicit update rather than assuming it will be overwritten automatically.</li><li>Save, use “Open character” (キャラを開く), select a greeting, and begin the conversation.</li></ol>
<p>For Hub content, open its details and import preview from Discover. Entering a URL alone does not save it. Importing also does not make a character official. Check the author, source, and content-specific license, and use it within the permissions granted to you.</p>`,
        },
        {
          id: 'write-clear-character-settings',
          title: 'Make personality and dialogue examples specific',
          html: `<p>For a first character, start with a short introduction, speech rules, a greeting that invites a reply, and a few dialogue examples. The manual Character.AI-style paste format requires <code>Name</code>. Put <code>Definition</code> last; the text that follows becomes its body. Here is an example for a fictional library guide:</p>
<pre><code>Name: Rio
Description: A guide who helps visitors find books in a quiet library
Greeting: Welcome. What kind of story are you looking for today?
Definition: Speak calmly in English. Do not invent details about unfamiliar books.
{{user}}: I'd like an adventure story.
{{char}}: Would you prefer a journey or a mystery to solve?</code></pre>
<p>The editor lets you refine greetings, style, scenario, dialogue examples, Lore, images, and generation settings. Concrete examples of questions and reply length often communicate your intent better than a label such as “kind” alone. To define the user's role or the setting separately, continue to <a href="{{doc:worlds}}">Personas and worlds</a>.</p>`,
        },
        {
          id: 'understand-lore-and-compatibility',
          title: 'Understand Lore and migration limits',
          html: `<p>A Lorebook supplies names and world knowledge when they become relevant. For example, use “north archive” as a keyword for the short definition “a room containing old voyage records.” Entries are selected according to activation conditions and estimated budgets, rather than all being inserted every turn. Researcher Debug lets you inspect which entries were used.</p>
<aside class="callout warning"><p>Scripts, dynamic variable operations, custom HTML, and advanced templates from the original app are not automatically executed. Unsupported items may be retained without being applied, or disabled with an explanation. Distinguish preservation from use during generation.</p></aside>
<p>Support also differs for SillyTavern settings, BYAF scenarios, and Risu common-card extensions. Character.AI uses manual pasting or JSON; account access and automatic retrieval of all history are unsupported. Round-trip acceptance in external apps is incomplete, so inspect migrated settings, images, and dialogue examples. See <a href="{{doc:privacy}}">Data and privacy</a> for image URLs and Hub communications.</p>`,
        },
        {
          id: 'keep-revisions-and-export',
          title: 'Use saved revisions and choose an export format',
          html: `<p>The original file and edited revisions are stored separately. Existing conversations keep their selected character, preset, and Lore revisions; they do not automatically switch to the latest edit. Changing a greeting, for example, does not silently replace the settings of an ongoing conversation. Check and explicitly switch the conversation's revision when you want the update.</p>
<ul><li>CCv2/v3 JSON or PNG: move a card to a compatible app; check differences in V3-specific fields and additional images.</li><li>CCv3 CHARX: bundle the card and embedded images.</li><li>Kyalulu backup: restore edited content, settings, selected history, and images within Kyalulu.</li><li>Original: retrieve the imported bytes, including unsupported elements retained there.</li></ul>
<p>A card alone cannot represent all conversation history or Kyalulu settings. Review the export's loss report and open it in the destination app to verify the result. Imported history also does not automatically create successful generation records or memories. Manage <a href="{{doc:memory}}">memory</a> separately, or choose another guide from the <a href="{{doc:index}}">index</a>.</p>`,
        },
      ],
    },
  },
  {
    slug: 'memory',
    group: 'use',
    icon: 'brain',
    title: { ja: '記憶を確認し、訂正する', en: 'Reviewing and correcting memory' },
    description: {
      ja: '初期オフの記憶機能を使い、共有範囲・確認待ち・検索と反映の限界を理解します。',
      en: 'Enable optional memory and understand its scope, pending proposals, retrieval, and practical limits.',
    },
    keywords: {
      ja: ['記憶', 'Memory Lab', '訂正', '確認待ち', '人物像', 'スコープ', 'Inspector'],
      en: ['memory', 'Memory Lab', 'correction', 'pending review', 'persona', 'scope', 'Inspector'],
    },
    readingMinutes: 6,
    sources: ['README.md', 'docs/ROADMAP.md', 'PROJECT_SPEC.md', 'docs/COMPATIBILITY.md'],
    sections: {
      ja: [
        {
          id: 'enable-memory-deliberately',
          title: '必要な会話だけで記憶を有効にする',
          html: `<p>記憶は、好みや出来事を次の会話でも参照するための保存機能です。会話履歴や現在の場面とは別に扱います。<strong>初期状態はオフ</strong>です。チャットの情報パネルで「覚えていること」を開き、「会話を覚える」をオンにすると、自動提案の保存と記憶の検索・注入を使います。</p>
<ol><li>使っているキャラと人物像の保存版を確認します。</li><li>「会話を覚える」をオンにします。</li><li>記憶一覧で保存内容を確認し、必要なら「覚えてほしいことを追加」から手動で登録します。</li><li>不要な会話ではオフへ戻します。オフの間は自動で覚えず、検索した記憶も会話へ入れません。</li></ol>
<p>記憶をオフにすることは、保存済みの記憶や会話履歴を削除することではありません。また、履歴に書かれている内容をモデルが参照する可能性は残ります。記憶機能の使用と履歴そのものの管理は分けて考えてください。データの扱いは<a href="{{doc:privacy}}">プライバシー</a>で説明しています。</p>`,
        },
        {
          id: 'check-memory-scope',
          title: 'どの会話で共有されるかを確認する',
          html: `<p>通常の共有範囲は<strong>キャラIDと人物像の保存版</strong>の組み合わせです。同じ組み合わせの別会話では記憶を参照できます。キャラを指定しないフリートークは、そのセッション内だけの記憶になります。実験用の記憶は独立したスコープで扱います。</p>
<p>たとえば「リオ＋旅人の人物像・版1」で保存した好みを、「リオ＋同じ人物像・版2」が自動で引き継ぐとは限りません。人物像を改版した後に記憶が見えない場合は、まず選択版を確認しましょう。版をまたぐ移行は自動化されていません。</p>
<aside class="callout warning"><p>世界観ごとの記憶分離も自動ではありません。同じキャラと人物像の版を使えば、別の世界観でも同じ共有範囲になります。独立した物語にしたい場合は、別の人物像を使うなど、共有範囲を意識して設計してください。</p></aside>
<p>人物像・舞台・場面の違いは<a href="{{doc:worlds}}">人物像と世界観</a>で確認できます。キャラや人物像を編集したという理由だけで、進行中の会話が最新版へ切り替わることもありません。</p>`,
        },
        {
          id: 'correct-and-remove-memories',
          title: '短く登録し、誤りを直接訂正する',
          html: `<p>登録できる種類は「好み・事実」「出来事・約束」「関係」です。一項目に多くの情報を詰めず、誰のことか、何が事実かを短く書くと確認しやすくなります。</p>
<table><thead><tr><th>種類</th><th>登録例</th></tr></thead><tbody><tr><td>好み・事実</td><td>旅人は辛い食べ物が苦手。</td></tr><tr><td>出来事・約束</td><td>旅人とリオは次の休日に書庫を整理する約束をした。</td></tr><tr><td>関係</td><td>旅人とリオは本を一緒に探す友人。</td></tr></tbody></table>
<p>誤りを見つけたら一覧の「訂正」で本文を直し、不要なら「忘れる」でその記憶を削除します。根拠の薄いモデル提案は「確認待ち・会話には未使用」として残り、未訂正のままでは注入されません。正しい内容に直すか削除するかを判断してください。</p>
<p>チャットで「それは違う」と返すだけでは保存項目が正しく直ったか判断できません。訂正後に一覧の本文を確認します。過去の会話文や書き出したバックアップまで消えるわけではないため、共有前にはそれらも確認しましょう。</p>`,
        },
        {
          id: 'inspect-and-understand-limits',
          title: '保存・検索・反映を別々に見る',
          html: `<p>「保存した」「検索候補になった」「プロンプトへ入った」「返事へ反映したと推定された」は別の段階です。ResearcherモードのMemory Inspectorでは、由来、時刻、版、候補、注入、推定量などを確認できます。保存があるのに思い出さない場合は、まず検索と注入を確認し、その後にモデルの返事を見ます。</p>
<p>公開実装の検索は文字bigramを使う方式で、意味の理解や矛盾の自動解消を保証するものではありません。返事への反映も文字一致などによる推定です。重要な約束は一覧を直接確認し、架空の内容が混ざっていないか見直してください。</p>
<aside class="callout warning"><p>公開の短期実モデル検証では、約束の未保存や虚偽想起が報告されています。Mockで長い会話を完走しても、長期記憶の正確さを保証しません。記憶は修正可能な補助情報として使い、完全な想起や忘却を前提にしないでください。</p></aside>
<p>キャラの知識をあらかじめ定義するLoreは<a href="{{doc:characters}}">キャラクター設定</a>で管理します。全ガイドへは<a href="{{doc:index}}">ドキュメント一覧</a>から戻れます。</p>`,
        },
      ],
      en: [
        {
          id: 'enable-memory-deliberately',
          title: 'Enable memory only where you need it',
          html: `<p>Memory stores preferences and events for later conversations. It is separate from conversation history and the current scene. <strong>It is off by default.</strong> In the chat information panel, open “Remembered information” (覚えていること) and enable “Remember this conversation” (会話を覚える) to use automatic memory proposals, retrieval, and prompt injection.</p>
<ol><li>Check the selected character and saved persona revision.</li><li>Enable the conversation's memory switch.</li><li>Review stored items; use “Add something to remember” (覚えてほしいことを追加) for a manual entry if needed.</li><li>Turn it off for conversations that do not need it. While off, automatic memory saving and retrieved-memory injection are disabled.</li></ol>
<p>Turning memory off does not delete saved memories or conversation history. A model may still refer to information present in the visible history. Treat memory use and history management as separate concerns. See <a href="{{doc:privacy}}">Data and privacy</a> for data handling.</p>`,
        },
        {
          id: 'check-memory-scope',
          title: 'Check which conversations share memory',
          html: `<p>The normal sharing scope combines the <strong>character ID and saved persona revision</strong>. Other conversations using that combination can retrieve the same memories. Free chat without a character keeps memory within that session. Experiments use their own independent memory scope.</p>
<p>For example, preferences saved with “Rio + traveler persona, revision 1” are not automatically carried into “Rio + the same persona, revision 2.” If memories appear missing after editing a persona, check the selected revision first. Migration across persona revisions is not automatic.</p>
<aside class="callout warning"><p>Memory is not automatically separated by world. The same character and persona revision use the same sharing scope even in a different world. For independent stories, design the scope deliberately, for example by using separate personas.</p></aside>
<p>See <a href="{{doc:worlds}}">Personas and worlds</a> for the distinction between persona, setting, and scene. Editing a character or persona also does not automatically switch an ongoing conversation to its latest revision.</p>`,
        },
        {
          id: 'correct-and-remove-memories',
          title: 'Write concise entries and correct errors directly',
          html: `<p>Memory categories are preferences and facts, events and promises, and relationships. Keep each entry focused, with a clear subject and a short factual statement.</p>
<table><thead><tr><th>Category</th><th>Example entry</th></tr></thead><tbody><tr><td>Preferences and facts</td><td>The traveler dislikes spicy food.</td></tr><tr><td>Events and promises</td><td>The traveler and Rio agreed to organize the archive on their next day off.</td></tr><tr><td>Relationships</td><td>The traveler and Rio are friends who look for books together.</td></tr></tbody></table>
<p>Use “Correct” (訂正) to edit an inaccurate entry, or “Forget” (忘れる) to remove it. Model proposals with weak evidence remain marked as pending review and unused in conversation. They are not injected until corrected. Decide whether to replace them with accurate information or remove them.</p>
<p>A chat reply such as “That's wrong” does not establish that the stored item was corrected. Check its text in the list afterward. This also does not erase earlier conversation text or exported backups, so inspect those before sharing.</p>`,
        },
        {
          id: 'inspect-and-understand-limits',
          title: 'Inspect storage, retrieval, and apparent use separately',
          html: `<p>“Stored,” “retrieval candidate,” “injected into the prompt,” and “apparently used in the reply” are different stages. Memory Inspector in Researcher mode shows provenance, time, revision, candidates, injection, and estimates. If a saved fact is not recalled, inspect retrieval and injection before assessing the model's reply.</p>
<p>The public implementation retrieves memory using character bigrams. It does not guarantee semantic understanding or automatic resolution of contradictions. Apparent use in a reply is also inferred from signals such as text matches. Check important promises directly in the memory list and look for invented details.</p>
<aside class="callout warning"><p>Public short-term real-model testing reports missed promise storage and false recall. Completing a long Mock conversation does not guarantee accurate long-term memory. Use memory as editable supporting information, without assuming perfect recall or forgetting.</p></aside>
<p>Predefined character knowledge belongs in Lore under <a href="{{doc:characters}}">character settings</a>. Return to the <a href="{{doc:index}}">documentation index</a> for all guides.</p>`,
        },
      ],
    },
  },
  {
    slug: 'worlds',
    group: 'use',
    icon: 'globe',
    title: { ja: '人物像と世界観を組み合わせる', en: 'Combining personas and worlds' },
    description: {
      ja: '自分の役割、物語の舞台、今の場面を分け、保存版と進行指定を会話へ適用します。',
      en: 'Separate your role, the setting, and the current scene, then apply saved revisions and story controls.',
    },
    keywords: {
      ja: ['世界観', '人物像', 'ペルソナ', 'World Creator', '場面', '物語', '版履歴'],
      en: ['worlds', 'personas', 'World Creator', 'scene', 'story controls', 'revisions'],
    },
    readingMinutes: 6,
    sources: ['README.md', 'docs/ROADMAP.md', 'PROJECT_SPEC.md', 'docs/COMPATIBILITY.md'],
    sections: {
      ja: [
        {
          id: 'separate-role-setting-and-scene',
          title: '役割・舞台・場面を分ける',
          html: `<p>同じキャラクターでも、誰として会い、どんな舞台で話すかによって会話の方向は変わります。Kyaluluではキャラクター、人物像（Persona）、世界観（World）を分けて管理します。人物像は会話でのあなたの役割、世界観は舞台の前提、場面は今起きている状況です。</p>
<table><thead><tr><th>設定</th><th>例</th></tr></thead><tbody><tr><td>キャラクター</td><td>本を探すのが得意な図書館案内人リオ。</td></tr><tr><td>人物像</td><td>港町を訪れた旅人。本の修繕が得意。</td></tr><tr><td>世界観</td><td>海辺の街。灯台の隣に古い図書館がある。</td></tr><tr><td>場面</td><td>雨の夕方、二人で航海記録を探している。</td></tr></tbody></table>
<p>毎回変わる出来事まで世界の恒久設定へ詰めず、舞台のルールと現在の状況を分けると再利用しやすくなります。話し相手の性格や挨拶は<a href="{{doc:characters}}">キャラクター</a>側で整えます。固有名詞の補足にはLorebookも使えますが、世界観の選択とLoreの採用は別の設定です。</p>`,
        },
        {
          id: 'create-and-select-revisions',
          title: '人物像と世界観を作り、会話で選ぶ',
          html: `<ol><li>CreateまたはStudioの「ペルソナ・世界観」を開きます。</li><li>人物像に名前と役割、話し相手に知ってほしい特徴をまとめます。</li><li>世界観に舞台と基本ルールを設定して保存します。</li><li>チャットの情報パネルにある「会話の設定」で人物像と舞台を選びます。</li><li>保存した版を確認し、その組み合わせで会話を進めます。</li></ol>
<p>作成・編集はJSON入出力と不変の版履歴に対応します。既存会話は選択した版を維持するため、世界観を編集しても進行中の物語が勝手に最新版へ変わることはありません。更新を適用したい会話では、選択版を明示的に見直してください。ほかの編集が進んでいる場合は、競合を無視して古い内容を上書きせず、最新の保存内容を確認します。</p>
<p>設定文は短い前提から始め、「魔法は使えない」「登場人物は灯台の秘密をまだ知らない」のように境界を具体化すると確認しやすくなります。これは生成への指示であり、厳密なゲームルールの実行を保証するものではありません。</p>`,
        },
        {
          id: 'guide-story-progression',
          title: '場面・目標・ペースを指定する',
          html: `<p>チャットの「物語の進め方」では、場面、目指す展開、ペースを指定できます。たとえば次のように、今の状況と次にしたいことを分けて書きます。</p>
<pre><code>場面：雨の夕方、図書館で古い航海記録を探している。
目指す展開：灯台に残された手掛かりについて相談する。
ペース：ゆっくり味わう。</code></pre>
<p>「会話に反映」を選ぶと指定を会話へ適用します。ペースは「自然に」「ゆっくり味わう」「展開を進める」から選べます。「指定を解除」で進行指定を取り除けますが、既に保存された会話が巻き戻るわけではありません。</p>
<p>モデルが急に場面を変えるなら、目標を一つに絞り、達成までの小さな行動を言葉で示してみましょう。細かい設定を大量に増やす前に、短い会話で方向を確認する方が修正しやすくなります。人物像や物語の条件を変えて比較する場合は、使った保存版と<a href="{{doc:models}}">モデル</a>も記録しておくと結果を見直せます。</p>`,
        },
        {
          id: 'protect-story-boundaries',
          title: '記憶の共有と物語の限界を意識する',
          html: `<aside class="callout warning"><p>世界を切り替えただけでは記憶は分離されません。通常の記憶スコープはキャラIDと人物像の保存版です。独立した物語で過去の約束を混ぜたくない場合は、人物像を分ける、記憶をオフにするなど、目的に合う設定を選びます。詳しくは<a href="{{doc:memory}}">記憶の共有範囲</a>を確認してください。</p></aside>
<p>世界観を選んでも、必ずすべての設定が守られるわけではありません。長い会話では文脈の上限、Loreの採用条件、モデルの指示追従の差が影響します。公開資料ではCreatorと会話設定の操作確認は記録されていますが、長期の世界整合性や実ユーザーの継続利用の受け入れは残っています。</p>
<p>大切な設定は曖昧な文章のまま増やさず、何を守ってほしいかを短く点検し、矛盾が見つかったら設定と保存版を見直します。JSONを書き出すときは人物像の個人情報も確認してください。共有の注意点は<a href="{{doc:privacy}}">プライバシー</a>へ、ほかの手順は<a href="{{doc:index}}">一覧</a>へ進めます。</p>`,
        },
      ],
      en: [
        {
          id: 'separate-role-setting-and-scene',
          title: 'Separate role, setting, and scene',
          html: `<p>A conversation with the same character can take different directions depending on who you are playing and where you meet. Kyalulu manages characters, personas, and worlds separately. A persona defines your role in the conversation; a world defines the setting's premises; a scene describes what is happening now.</p>
<table><thead><tr><th>Setting</th><th>Example</th></tr></thead><tbody><tr><td>Character</td><td>Rio, a library guide who is good at finding books.</td></tr><tr><td>Persona</td><td>A traveler visiting a port town, skilled at repairing books.</td></tr><tr><td>World</td><td>A seaside town with an old library beside its lighthouse.</td></tr><tr><td>Scene</td><td>The two are looking for voyage records on a rainy evening.</td></tr></tbody></table>
<p>Keep lasting world rules separate from changing events to make the setting easier to reuse. Define your conversation partner's personality and greetings under <a href="{{doc:characters}}">Characters</a>. Lorebooks can supply details about names and concepts, but world selection and Lore activation are separate settings.</p>`,
        },
        {
          id: 'create-and-select-revisions',
          title: 'Create a persona and world, then select them in chat',
          html: `<ol><li>Open “Personas and worlds” (ペルソナ・世界観) in Create or Studio.</li><li>Give the persona a name, role, and traits your conversation partner should know.</li><li>Define and save the world's setting and basic rules.</li><li>In the chat information panel, select the persona and setting under “Conversation settings” (会話の設定).</li><li>Check the saved revisions and continue with that combination.</li></ol>
<p>Creation and editing support JSON import/export and immutable revision history. Existing conversations keep their selected revisions, so editing a world does not silently update an ongoing story. Explicitly review the selected revision when you want to apply an update. If another edit has occurred, inspect the latest saved content rather than ignoring a conflict and overwriting it with stale data.</p>
<p>Begin with concise premises and specific boundaries, such as “magic cannot be used” or “the characters do not yet know the lighthouse's secret.” These are instructions for generation; they do not guarantee enforcement as strict game rules.</p>`,
        },
        {
          id: 'guide-story-progression',
          title: 'Set a scene, goal, and pace',
          html: `<p>The chat's “Story progression” (物語の進め方) controls let you specify the scene, intended development, and pace. Separate the current situation from the next step you want:</p>
<pre><code>Scene: Looking for old voyage records in the library on a rainy evening.
Goal: Discuss a clue left at the lighthouse.
Pace: Take it slowly.</code></pre>
<p>Select “Apply to conversation” (会話に反映) to use the settings. Available paces are natural, slow, and move the story forward. “Clear instructions” (指定を解除) removes the progression instructions; it does not rewind saved conversation history.</p>
<p>If the model changes scenes too abruptly, focus on one goal and describe a small action toward it. Check the direction in a short conversation before adding many detailed instructions. When comparing personas or story conditions, record the saved revisions and the <a href="{{doc:models}}">model</a> so you can review the result later.</p>`,
        },
        {
          id: 'protect-story-boundaries',
          title: 'Consider memory sharing and story limits',
          html: `<aside class="callout warning"><p>Switching worlds alone does not separate memory. The normal memory scope combines character ID and saved persona revision. For independent stories, use suitable settings such as separate personas or disabled memory to avoid mixing earlier promises. See <a href="{{doc:memory}}">Memory scope</a> for details.</p></aside>
<p>Selecting a world does not guarantee that every premise will be followed. Long conversations are affected by context limits, Lore activation, and differences in model instruction following. Public materials record Creator and conversation-setting checks, while long-term world consistency and sustained use by real users still require acceptance.</p>
<p>Keep important rules concise and explicit rather than accumulating ambiguous descriptions. If a contradiction appears, review the settings and selected revisions. Check personas for personal information before exporting JSON. Continue to <a href="{{doc:privacy}}">Data and privacy</a> for sharing considerations, or return to the <a href="{{doc:index}}">index</a>.</p>`,
        },
      ],
    },
  },
  {
    slug: 'privacy',
    group: 'reference',
    icon: 'shield',
    title: { ja: 'データとプライバシー', en: 'Data and privacy' },
    description: {
      ja: 'ローカル保存、推論先への送信、Hub取得、書き出し、Remoteの境界を確認します。',
      en: 'Understand local storage, provider requests, Hub fetching, exports, and the limits of Remote.',
    },
    keywords: {
      ja: ['プライバシー', 'ローカル保存', '外部API', 'APIキー', 'バックアップ', 'Hub', 'Remote'],
      en: ['privacy', 'local storage', 'external API', 'API keys', 'backup', 'Hub', 'Remote'],
    },
    readingMinutes: 7,
    sources: ['README.md', '.env.example', 'docs/COMPATIBILITY.md', 'docs/REMOTE.md', 'docs/ROADMAP.md'],
    sections: {
      ja: [
        {
          id: 'understand-local-first',
          title: 'ローカル保存と通信を分けて考える',
          html: `<p>Kyaluluはローカル保存を中心にしたアプリです。会話、キャラクターライブラリ、記憶などをRuntime側で管理し、SQLiteや画像資産を使って保存します。開発用checkoutの既定保存先とDesktop配布用ビルドの保存先は異なり、保存先指定も可能です。Statusの接続診断で現在の保存先を確認してください。</p>
<p><strong>ローカルファーストは「通信が一切ない」という意味ではありません。</strong>外部APIをモデルに選ぶと、生成に必要なキャラ設定、人物像、世界観、可視会話履歴、採用されたLoreや記憶などが、その接続先へ送られます。ローカルのLEやLM Studioを経由していても、背後のProviderが外部なら送信先は外部です。</p>
<table><thead><tr><th>操作</th><th>確認する境界</th></tr></thead><tbody><tr><td>Mock Echoの会話</td><td>モデル用の外部APIは不要。</td></tr><tr><td>ローカルモデルの生成</td><td>選んだエンジンと実際の接続先を確認。</td></tr><tr><td>外部APIの生成</td><td>プロンプトを接続先へ送信。保持・利用規約は提供元次第。</td></tr><tr><td>Hub検索・URL取り込み</td><td>配布元への検索・ファイル取得通信が発生。</td></tr></tbody></table>
<p>モデルの接続方法は<a href="{{doc:models}}">モデルと接続先</a>で確認できます。実験データは既定で外部送信されませんが、外部モデルを使う実験の生成入力までローカルに留まるとは考えないでください。</p>`,
        },
        {
          id: 'protect-keys-and-hub-access',
          title: 'キーとHubへのアクセスを管理する',
          html: `<p>APIキーは自分の<code>.env</code>などAPI側の設定へ置き、共有用の説明、スクリーンショット、キャラカードへ貼り付けないでください。LEのトークンもAPI側が保持し、通常のWeb画面へ渡しません。モデル設定のURLが意図したローカル／外部の接続先かを確認してから使います。</p>
<p>公開資料では、ライブラリの初期表示だけではHubへ通信しません。Hubを選んで検索・取り込みを行うと、検索語、コンテンツID、ファイルパスなどを配布元へ送ります。会話履歴やモデル認証情報はHubへ送らない設計です。外部Hubを新しいタブで開けば、そのサイト自体の通信・規約も適用されます。</p>
<p>取り込みはプレビューで内容と出典を確認してから保存します。カード内のスクリプトや認証・モデルロードは自動実行されず、外部画像URLは参照として保持され、自動ダウンロードされません。ただし、この動作を第三者サイト全体の安全性の保証とは扱わないでください。移行の制限は<a href="{{doc:characters}}">キャラクター記事</a>にまとめています。</p>`,
        },
        {
          id: 'review-storage-and-exports',
          title: '記憶・履歴・書き出しを個別に確認する',
          html: `<p>記憶は初期オフです。オンにすると保存された項目が検索され、選んだモデルへの生成入力に入る場合があります。オフは削除ではなく、記憶項目の削除も既存の会話文、原本、バックアップまで消す操作ではありません。何を消したいかに応じて、それぞれの保存物を確認してください。</p>
<ol><li>記憶一覧で個人情報や誤った内容を点検し、必要なら訂正・削除します。</li><li>共有する会話履歴や人物像のJSONに、名前、連絡先、私的な出来事が含まれていないか確認します。</li><li>カード、CHARX、Kyaluluバックアップ、原本のどれを書き出すか確認します。形式によって画像・設定・選択履歴などの範囲が異なります。</li><li>書き出したファイルとバックアップの保存場所を管理します。Debugや実験結果を共有するときも、プロンプトや保存内容を確認します。</li></ol>
<p>原本には編集画面で使わなかった履歴や未対応要素が残る場合があります。編集結果だけを見て共有可否を決めないでください。また、通常のローカルデータが保存時にすべて暗号化されるとの保証はありません。PCのユーザーアカウント、端末へのアクセス、バックアップを含めて保護しましょう。記憶の詳しい操作は<a href="{{doc:memory}}">記憶ガイド</a>へ進めます。</p>`,
        },
        {
          id: 'understand-remote-limits',
          title: 'Remoteの暗号化と未完了の検証を理解する',
          html: `<p>公開のKyalulu Remoteは開発候補です。PWAとPC Hostの間をNoiseで暗号化し、Relayは経路情報を中継します。会話と記憶はHostに残り、Remote自体がクラウド推論へ置き換えるわけではありません。PCが停止・スリープ中なら利用できず、Hostを変えても履歴は自動同期されません。</p>
<p>通信の暗号化は、Relayから本文を隠すためのものです。IP、時刻、通信量などのメタデータは隠せず、端末やPWA配布元が侵害された場合の平文取得も防げません。スマートフォンのキーや下書きの端末内保存を、共有端末で安全な暗号化保存と同一視しないでください。</p>
<aside class="callout warning"><p>Remoteは承認済みv1.0.0リリースではありません。公開資料はAndroid実機、実モデル、運用TLS、長時間試験、外部セキュリティレビューを公開前の確認事項として挙げています。実装や内部試験を、一般公開向けのセキュリティ保証へ読み替えないでください。</p></aside>
<p>登録済み端末を紛失したらPC側で端末登録を失効させます。スマートフォン内のキー削除だけではサーバー側登録の失効にはなりません。まずローカルで始めるには<a href="{{doc:quickstart}}">導入手順</a>へ、公開資料を基にした各機能の説明は<a href="{{doc:index}}">ドキュメント一覧</a>から参照できます。</p>`,
        },
      ],
      en: [
        {
          id: 'understand-local-first',
          title: 'Distinguish local storage from network traffic',
          html: `<p>Kyalulu centers on local storage. The Runtime manages conversations, the character library, and memories, using SQLite and image assets. Default locations differ between a development checkout and a Desktop distribution build, and can be configured. Check the active location in Status connection diagnostics.</p>
<p><strong>Local-first does not mean there is no network traffic.</strong> Choosing an external model API sends the inputs needed for generation to that endpoint. These can include character settings, persona, world, visible conversation history, selected Lore, and retrieved memories. Even when you connect through local LE or LM Studio, an external backend still means an external destination.</p>
<table><thead><tr><th>Action</th><th>Boundary to check</th></tr></thead><tbody><tr><td>Mock Echo chat</td><td>No external model API required.</td></tr><tr><td>Local-model generation</td><td>Check the engine and its actual destination.</td></tr><tr><td>External API generation</td><td>Prompts go to the endpoint; retention and terms depend on its provider.</td></tr><tr><td>Hub search or URL import</td><td>Search and file-fetch requests reach the distributor.</td></tr></tbody></table>
<p>See <a href="{{doc:models}}">Models and connections</a> for routing. Experiment data is not sent externally by default, but that does not keep generation inputs local when an experiment uses an external model.</p>`,
        },
        {
          id: 'protect-keys-and-hub-access',
          title: 'Manage keys and Hub access',
          html: `<p>Keep API keys in API-side configuration such as your own <code>.env</code>. Do not paste them into shared instructions, screenshots, or character cards. LE tokens also remain on the API side and are not passed to the normal web interface. Verify that the configured model URL points to the local or external destination you intend.</p>
<p>Public materials state that the initial library view does not contact Hubs. Selecting a Hub to search or import sends information such as search terms, content IDs, and file paths to the distributor. The design does not send conversation history or model credentials to Hubs. Opening an external Hub in a new tab also subjects that visit to the site's own network behavior and terms.</p>
<p>Review imported content and its source before saving. Imports do not automatically execute card scripts, authentication, or model loading. External image URLs are retained as references rather than downloaded automatically. These behaviors do not guarantee the safety of an entire third-party site. See <a href="{{doc:characters}}">Characters</a> for migration limits.</p>`,
        },
        {
          id: 'review-storage-and-exports',
          title: 'Review memory, history, and exports separately',
          html: `<p>Memory is off by default. Enabling it allows stored items to be retrieved and potentially included in inputs to the selected model. Turning it off is not deletion. Deleting a memory also does not erase existing conversation text, original files, or backups. Check each stored artifact according to what you want to remove.</p>
<ol><li>Inspect memory entries for personal information and errors; correct or remove them if needed.</li><li>Check shared history and persona JSON for names, contact details, and private events.</li><li>Confirm whether you are exporting a card, CHARX, Kyalulu backup, or original. Their coverage of images, settings, and selected history differs.</li><li>Manage exported files and backups. Inspect prompts and stored content before sharing Debug output or experiment results as well.</li></ol>
<p>Original files may retain unselected history and unsupported elements. Do not decide whether they are safe to share based only on the edited view. There is also no guarantee that all ordinary local data is encrypted at rest. Protect your PC account, device access, and backups. See <a href="{{doc:memory}}">Memory</a> for the editing workflow.</p>`,
        },
        {
          id: 'understand-remote-limits',
          title: 'Understand Remote encryption and outstanding validation',
          html: `<p>The public Kyalulu Remote implementation is a development candidate. Noise encrypts communication between the PWA and PC Host, while the Relay routes traffic. Conversations and memories remain on the Host; Remote itself does not replace inference with cloud generation. A sleeping or offline PC is unavailable, and switching Hosts does not synchronize history automatically.</p>
<p>Transport encryption hides message content from the Relay. It does not hide metadata such as IP addresses, timing, or transfer sizes, or prevent plaintext capture if an endpoint or PWA distributor is compromised. Phone storage of keys and drafts should not be treated as secure encrypted storage on a shared device.</p>
<aside class="callout warning"><p>Remote is not an approved v1.0.0 release. Public materials list Android physical-device testing, real-model acceptance, production TLS operations, endurance testing, and external security review as release gates. Implementation and internal tests do not establish a security guarantee for public deployment.</p></aside>
<p>If a registered phone is lost, revoke its registration from the PC. Deleting a key on the phone alone does not revoke the server-side registration. To begin locally, follow <a href="{{doc:quickstart}}">Getting started</a>, or consult the <a href="{{doc:index}}">documentation index</a> for guides based on public materials.</p>`,
        },
      ],
    },
  },
];
