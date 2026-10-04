# Xeque para Android

O projeto Android está em `android/` e usa Kotlin com interface nativa. Os dicionários ficam dentro do APK: depois da instalação, as partidas podem funcionar sem conexão. O site usa o navegador; o aplicativo Android mantém seus dados no armazenamento local do aplicativo. O progresso das duas versões não é sincronizado.

## Instalar

Requer **Android 8.0 / API 26 ou superior**.

1. Abra [as releases do projeto](https://github.com/DanielTR048/xeque-palavras/releases).
2. Baixe o arquivo **xeque-android.apk** da release desejada. O [endereço estável do APK mais recente](https://github.com/DanielTR048/xeque-palavras/releases/latest/download/xeque-android.apk) funciona quando uma release publicada contém esse arquivo.
3. Abra o download no aparelho. Se o Android solicitar, permita a instalação por esse navegador ou gerenciador de arquivos e confirme a instalação.
4. Abra **Xeque**. Português e inglês, modos e dificuldades estão disponíveis no próprio aplicativo.

Um APK de desenvolvimento produzido pela CI serve para validação. O arquivo destinado à instalação pública precisa ser uma compilação **release assinada**, com sua versão e SHA-256 informados na release. Publicar o código ou concluir o build não equivale a publicar esse APK.

Atualizações devem manter a mesma identidade de assinatura. Uma instalação anterior com outra assinatura pode exigir desinstalação, removendo seu progresso local. Consulte as notas da release antes de substituir uma versão instalada.

## Compilar a partir do código

Ferramentas usadas pelo projeto:

| Componente | Versão |
| --- | --- |
| JDK | 21 |
| Gradle Wrapper | 8.13 |
| Android Gradle Plugin | 8.13.2 |
| Kotlin | 2.2.21 |
| compileSdk / targetSdk | 36 |
| minSdk | 26 |
| Node.js para preparar os dados | 20 ou superior |

Instale o Android SDK com plataforma 36, platform-tools e build-tools compatíveis com o projeto. Configure `ANDROID_HOME` ou `android/local.properties` para o caminho local do SDK. O arquivo `local.properties` é específico da máquina e não deve ser versionado.

Na raiz do repositório, prepare os dados:

```sh
node scripts/prepare-android-assets.mjs
```

Esse comando usa somente arquivos locais. Ele verifica os dicionários, as licenças e a lista de respostas comuns antes de gerar os assets. O comando `npm run words:build` é diferente: ele baixa as fontes fixadas para reconstruir os dicionários e precisa de internet.

No PowerShell:

```powershell
Set-Location android
.\gradlew.bat test assembleDebug
```

No Linux ou macOS:

```sh
cd android
chmod +x gradlew
./gradlew test assembleDebug
```

O APK de desenvolvimento é gerado em `android/app/build/outputs/apk/debug/app-debug.apk`. A primeira compilação precisa de internet para baixar Gradle, plugins e dependências; o jogo instalado usa os assets locais.

## Assinatura de distribuição

O build de release recebe a configuração por variáveis de ambiente:

- `XEQUE_KEYSTORE`: caminho absoluto do keystore mantido fora do repositório.
- `XEQUE_STORE_PASSWORD`: senha do keystore.
- `XEQUE_KEY_ALIAS`: alias da chave.
- `XEQUE_KEY_PASSWORD`: senha da chave.

Configure esses valores no ambiente local sem os registrar no histórico de comandos, na documentação ou em arquivos versionados. Preserve o keystore e seu backup privado: a mesma chave é necessária para atualizar a aplicação já instalada.

Com a assinatura configurada e os assets preparados, execute no diretório `android/`:

```powershell
.\gradlew.bat test assembleRelease
```

A saída esperada é `app/build/outputs/apk/release/app-release.apk`. Antes de distribuí-la, verifique a assinatura com `apksigner verify --verbose --print-certs`, calcule seu SHA-256 e teste a instalação. Consulte [o processo de release](RELEASE.md).

O script [android-build.ps1](../scripts/android-build.ps1) automatiza, no Windows, a preparação dos assets, os testes, o lint, a compilação, a verificação de assinatura e a inspeção dos dicionários e permissões do APK. Ele usa `JAVA_HOME` e `ANDROID_HOME` quando configurados, ou procura as ferramentas no diretório informado por `-ToolchainRoot`. A assinatura pode vir das variáveis acima ou de um arquivo privado externo ao repositório, informado por `-SigningConfig`.

```powershell
.\scripts\android-build.ps1 -Configuration Release
```

Execute esse comando na raiz do repositório, com o ambiente e a assinatura já configurados. A saída é copiada para `artifacts/android/`, acompanhada de seu SHA-256. O script não faz upload nem publica uma release.

## Dados incluídos

O script gera:

```text
android/app/src/main/assets/
  dictionaries/
    pt.json
    en.json
    common.json
    sources.json
  licenses/
    LICENSE-pt.txt
    LICENSE-en.txt
    LICENSE-Kotlin.txt
    NOTICE-Kotlin.txt
```

`pt.json` e `en.json` preservam o mesmo formato da versão web: `language`, `words`, `count`, `byLength` e `source`. `common.json` contém os idiomas `pt` e `en`, cada um com arrays nas chaves `4`, `5`, `6`, `7` e `8`. Arquivos gerados são ignorados pelo Git e precisam ser preparados novamente após um checkout limpo ou mudança de dicionários.

Veja [os critérios dos dicionários](DICTIONARIES.md) e [os avisos de terceiros](THIRD_PARTY_NOTICES.md). A documentação de build e os testes automatizados não substituem a confirmação de instalação em um aparelho Android.
