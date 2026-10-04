# Publicação e releases

O código-fonte é mantido em [DanielTR048/xeque-palavras](https://github.com/DanielTR048/xeque-palavras). A versão web e o APK nativo são entregas independentes, geradas a partir de uma revisão identificável do repositório.

| Entrega | Resultado | Dados do jogador |
| --- | --- | --- |
| Web | Site estático gerado pelo Vite, publicado em Sites | Armazenamento local do navegador |
| Android | APK Kotlin nativo, de release e assinado | Armazenamento local do aplicativo |

O Android inclui os dicionários e permite jogar sem conexão após instalado. O site requer acesso aos seus arquivos pelo navegador; esta documentação não promete instalação PWA ou disponibilidade offline da versão web. As versões não possuem contas nem sincronização de progresso.

## Validar uma revisão

Na raiz:

```sh
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:e2e
node scripts/prepare-android-assets.mjs
```

No diretório `android/`, execute os testes e a compilação conforme [ANDROID.md](ANDROID.md). O workflow [CI](../.github/workflows/ci.yml) executa verificações web e Android em jobs separados. No Android, a CI executa `test assembleDebug`, conserva relatórios e não publica um APK de desenvolvimento como release.

Build local, execução da CI remota, site publicado, APK assinado e instalação no aparelho são evidências diferentes. Registre quais delas foram concluídas para a versão distribuída.

## Publicar a versão web

1. Execute as validações web da revisão escolhida.
2. Gere `dist/` com `npm run build`, incluindo dicionários e arquivos de licença presentes em `public/`.
3. Publique essa saída pelo fluxo do Sites.
4. Confirme a URL entregue pelo publicador e abra o site publicado. Verifique troca de idioma, uma partida, Quarteto no celular e carregamento dos dicionários.

Uma URL registrada ou esperada ainda precisa de publicação e verificação para ser anunciada como site disponível.

No Windows, o empacotador do Sites pode precisar do GNU tar fornecido pelo Git para Windows. Antes de executar o helper oficial, ajuste apenas o ambiente do terminal atual:

```powershell
$env:PATH = 'C:\Program Files\Git\bin;C:\Program Files\Git\usr\bin;' + $env:PATH
$env:TAR_OPTIONS = '--force-local'
```

`--force-local` impede que caminhos como `F:\...` sejam interpretados pelo tar como um host remoto. Siga o protocolo do helper oficial: credenciais temporárias entram pela entrada padrão, sem inclusão em comandos, arquivos do projeto ou logs.

## Publicar o APK

1. Atualize `versionCode` e `versionName` do módulo Android quando necessário.
2. Prepare os assets e execute os testes.
3. Compile `assembleRelease` com o keystore do mantenedor, guardado fora do repositório.
4. Verifique a assinatura do APK com `apksigner verify --verbose --print-certs`.
5. Calcule o SHA-256 e teste a instalação e abertura, preferencialmente também sem conexão. Registre o dispositivo ou emulador utilizado.
6. Anexe o APK verificado a uma release da revisão escolhida, com o nome **xeque-android.apk**. Inclua versão, requisitos, SHA-256, alterações e limitações verificadas nas notas.
7. Abra a página pública da release e confirme que o download corresponde ao APK verificado.

O endereço estável utilizado para download é:

[Baixar xeque-android.apk da release mais recente](https://github.com/DanielTR048/xeque-palavras/releases/latest/download/xeque-android.apk)

Esse endereço depende da existência de uma release publicada com exatamente esse nome de asset. A página de [releases](https://github.com/DanielTR048/xeque-palavras/releases) permite escolher uma versão específica e consultar as evidências disponíveis.

Para obter o hash no PowerShell:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'android/app/build/outputs/apk/release/app-release.apk'
```

As chaves de assinatura não fazem parte do código público nem dos artefatos da CI. O mesmo keystore deve ser preservado para futuras atualizações. Não publique keystores, senhas, `local.properties`, dados de aparelho ou arquivos temporários de assinatura.

## Licenças e dados

As licenças dos dicionários, fontes e bibliotecas devem acompanhar a distribuição correspondente. Consulte [DICTIONARIES.md](DICTIONARIES.md) e [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Os avisos de terceiros não atribuem uma licença ao código original do projeto; tornar um repositório público não altera, por si só, as permissões concedidas por seu autor.
