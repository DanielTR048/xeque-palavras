# Publicação e releases

O código-fonte é mantido em [DanielTR048/xeque-palavras](https://github.com/DanielTR048/xeque-palavras). A versão web e o APK nativo são entregas independentes, geradas a partir de uma revisão identificável do repositório.

| Entrega | Resultado | Dados do jogador |
| --- | --- | --- |
| Web | Interface React/Vite e Worker publicados no Sites do GPT | Documento local por perfil e D1 do Sites |
| Android | APK Kotlin nativo, de release e assinado | Documento local por perfil; sincronização após pareamento |

O Android inclui os dicionários e permite jogar sem conexão após instalado. O site requer acesso aos seus arquivos pelo navegador; esta documentação não promete instalação PWA ou disponibilidade offline da versão web. A versão **1.1** oferece Daniel e Larissa como perfis da mesma conta, migra o progresso anterior para Daniel e sincroniza os aparelhos autorizados. O acesso do Sites permanece privado ao proprietário.

## Validar uma revisão

Na raiz:

Use **Node.js 22.12 ou superior**, incluindo para os testes de API e o Worker local.

```sh
npm ci
npm test
npm run build
npm run test:cloud
npx playwright install chromium
npm run test:e2e
node scripts/prepare-android-assets.mjs
```

No diretório `android/`, execute os testes e a compilação conforme [ANDROID.md](ANDROID.md). O workflow [CI](../.github/workflows/ci.yml) executa verificações web e Android em jobs separados. No Android, a CI executa `test assembleDebug`, conserva relatórios e não publica um APK de desenvolvimento como release.

Build local, execução da CI remota, site publicado, APK assinado e instalação no aparelho são evidências diferentes. Registre quais delas foram concluídas para a versão distribuída.

## Publicar a versão web

1. Execute as validações web da revisão escolhida.
2. Gere `dist/` e `dist/server/index.js` com `npm run build`, incluindo dicionários e arquivos de licença presentes em `public/`.
3. Preserve o mesmo `project_id` e a audiência privada em `.openai/hosting.json`. O manifesto da versão 1.1 declara D1 em `DB`; não é uma publicação puramente estática.
4. Se houver mudança de esquema, gere e revise as migrações com `npm run db:generate`, incluindo SQL e metadados no commit. Não altere migrações já aplicadas. O Sites aplica as migrações pendentes na publicação.
5. Configure os segredos de produção apenas pelas ferramentas do Sites. `SITES_DEVICE_GATE` contém o valor de acesso de serviço já existente, necessário para entregar credenciais criptografadas a um aparelho autorizado. Nunca inclua esse valor no código, APK, manifesto, arquivo público, relatório ou comando de terminal. `LOCAL_TEST_OWNER` é exclusivo do runtime local e não deve ser configurado em produção.
6. Publique a revisão e o pacote correspondente pelo fluxo oficial do Sites, usando a operação apropriada para a audiência privada. Preserve a audiência durante a atualização.
7. Confirme a URL entregue pelo publicador e abra o site publicado. Verifique seleção dos dois perfis, troca de idioma, uma partida, Quarteto no celular e carregamento dos dicionários.

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
5. Calcule o SHA-256 e teste a instalação e abertura sem conexão. Teste a atualização sobre o APK assinado anterior, a migração do progresso para Daniel e a separação de Larissa. Registre o dispositivo ou emulador utilizado.
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

## Verificar a integração da versão 1.1

As notas da release devem identificar quais etapas abaixo foram efetivamente concluídas. Não anunciar integração publicada como testada com base apenas em testes locais.

1. Abrir o aplicativo atualizado sem rede e verificar Daniel, Larissa e os dados anteriores migrados.
2. Autorizar um aparelho pelo navegador com a conta que acessa o Sites, conferindo o código de pareamento. Validar o retorno ao aplicativo e a alternativa de copiar/colar o envelope.
3. Fazer uma jogada no site, sincronizar e continuar no Android com o mesmo perfil. Repetir no sentido Android → site.
4. Jogar sem rede, fechar e reabrir o aplicativo, restabelecer a conexão e confirmar o envio das alterações pendentes sem duplicar partidas ou estatísticas.
5. Trocar de perfil durante uma requisição e verificar que respostas atrasadas não sejam aplicadas ao outro jogador.
6. Revogar o aparelho pelo site. Confirmar que as requisições seguintes sejam recusadas, mantendo o progresso offline disponível, e que novo pareamento restaure a sincronização.
7. Confirmar que o APK e os arquivos públicos não contenham credenciais, dados dos jogadores ou identidades artificiais de teste.

O APK 1.1 usa `INTERNET` e `ACCESS_NETWORK_STATE` exclusivamente como permissões normais para a sincronização e detecção de conexão. A presença dessas permissões não altera a exigência de funcionar offline. A assinatura original é preservada para atualizar a instalação existente.

## Licenças e dados

As licenças dos dicionários, fontes e bibliotecas devem acompanhar a distribuição correspondente. Consulte [DICTIONARIES.md](DICTIONARIES.md) e [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Os avisos de terceiros não atribuem uma licença ao código original do projeto; tornar um repositório público não altera, por si só, as permissões concedidas por seu autor.
