# Xeque para Android

O projeto Android está em `android/` e usa Kotlin com interface nativa. Os dicionários ficam dentro do APK: depois da instalação, as partidas funcionam sem conexão. A versão **1.1** acrescenta os perfis **Daniel** e **Larissa** e sincronização opcional com o site. Cada perfil conserva seu próprio progresso no armazenamento privado do aplicativo.

## Instalar

Requer **Android 8.0 / API 26 ou superior**.

1. Abra [as releases do projeto](https://github.com/DanielTR048/xeque-palavras/releases).
2. Baixe o arquivo **xeque-android.apk** da release desejada. O [endereço estável do APK mais recente](https://github.com/DanielTR048/xeque-palavras/releases/latest/download/xeque-android.apk) funciona quando uma release publicada contém esse arquivo.
3. Abra o download no aparelho. Se o Android solicitar, permita a instalação por esse navegador ou gerenciador de arquivos e confirme a instalação.
4. Abra **Xeque** e escolha **Daniel** ou **Larissa**. Português e inglês, modos e dificuldades estão disponíveis no próprio aplicativo.

Um APK de desenvolvimento produzido pela CI serve para validação. O arquivo destinado à instalação pública precisa ser uma compilação **release assinada**, com sua versão e SHA-256 informados na release. Publicar o código ou concluir o build não equivale a publicar esse APK.

Atualizações devem manter a mesma identidade de assinatura. Uma instalação anterior com outra assinatura pode exigir desinstalação, removendo seu progresso local. Consulte as notas da release antes de substituir uma versão instalada.

## Perfis e atualização da versão 1.0

Na atualização, as partidas e estatísticas anteriores são importadas uma vez para **Daniel**. Os dados antigos permanecem preservados como cópia local. **Larissa** tem armazenamento próprio e começa sem as partidas de Daniel. É possível trocar de perfil pela interface, mantendo o progresso de cada um.

Os perfis pertencem à mesma conta de sincronização e não têm senhas individuais. Selecionar um nome não autentica uma nova conta ChatGPT.

## Conectar ao site

1. No Android, toque em **Conectar ao site** e depois em **Abrir navegador**.
2. Entre no Sites do GPT com a conta que tem acesso ao [Xeque](https://xeque-palavras.nexcoreadm.chatgpt.site). A audiência do site continua privada ao proprietário.
3. Confira o código do aparelho mostrado no aplicativo e no site e autorize a conexão.
4. Volte ao aplicativo pelo botão da página. Se o navegador não abrir o retorno automaticamente, use a opção de copiar e colar o código de conexão.
5. Escolha o perfil e acompanhe o indicador de sincronização. **Sincronizar agora** permite tentar novamente manualmente.

Esse pareamento é necessário uma vez por aparelho, até que o acesso seja removido ou os dados do aplicativo sejam apagados. Daniel pode autorizar os aparelhos utilizados pelos dois. Larissa não precisa autenticar outra conta ChatGPT para usar seu perfil em um aparelho já conectado.

As alterações offline ficam no documento local até a próxima sincronização bem-sucedida. O aplicativo tenta sincronizar durante o uso e quando é aberto novamente com conexão; não depende de permanecer executando em segundo plano. A versão web também mantém uma cópia local e envia as alterações enquanto está aberta. O mesmo perfil deve ser selecionado nos dois lados para continuar a mesma partida.

O APK declara as permissões normais **INTERNET** e **ACCESS_NETWORK_STATE** para a sincronização. O Android não apresenta uma solicitação de permissão em tempo de execução para elas. A conexão ao site é opcional; as partidas e os dicionários continuam disponíveis sem rede.

Credenciais não acompanham o APK público. Elas são entregues somente após autorização, em um envelope criptografado, e armazenadas protegidas pelo Android Keystore. O aplicativo envia suas credenciais somente à origem HTTPS fixa do Xeque e não segue redirecionamentos nessas requisições.

## Desconectar e revogar

**Desconectar aparelho**, no Android, remove o vínculo local e mantém as partidas offline. No site, abra as configurações de sincronização e **Aparelhos conectados** para revogar o acesso de um dispositivo. Um aparelho revogado deixa de sincronizar e precisa ser autorizado novamente; sua cópia local do progresso permanece disponível.

Falha de rede ou de autorização não apaga o documento local. Divergências entre partidas são preservadas pelo servidor, sem somar duas vezes o mesmo resultado. Os limites, a migração de estatísticas e as regras de mesclagem estão no [contrato de sincronização](SYNC-CONTRACT.md).

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

Veja [os critérios dos dicionários](DICTIONARIES.md) e [os avisos de terceiros](THIRD_PARTY_NOTICES.md). A documentação descreve o comportamento implementado; as notas de cada release devem registrar separadamente a instalação offline, o pareamento real e a sincronização Android ↔ site que foram efetivamente verificados. Testes locais e compilação não comprovam, por si só, a integração publicada.
