# Xeque

Jogo de descobrir palavras com identidade visual inspirada no xadrez: casas alternadas, peças e desafios de vocabulário. Interface responsiva em português e inglês, feita com **React, TypeScript e Vite**.

Também inclui um aplicativo **Android nativo em Kotlin**, com os dicionários dentro do APK para jogar offline desde a primeira abertura, após a instalação.

## Links

- [Código-fonte no GitHub](https://github.com/DanielTR048/xeque-palavras).
- [Versão web no Sites do GPT](https://xeque-palavras.nexcoreadm.chatgpt.site).
- [Baixar o APK Android](https://github.com/DanielTR048/xeque-palavras/releases/latest/download/xeque-android.apk) ou [consultar versões e notas de instalação](https://github.com/DanielTR048/xeque-palavras/releases).

O Sites do GPT controla as permissões de acesso à versão web; a publicação inicial mantém o acesso do proprietário. O link de download do APK corresponde ao arquivo `xeque-android.apk` da release mais recente.

## Android offline

Requer **Android 8.0 ou superior**. Baixe o APK, abra o arquivo no aparelho e autorize a instalação por esse navegador ou gerenciador de arquivos quando o Android solicitar. Os dicionários em português e inglês acompanham o aplicativo, sem download adicional para iniciar uma partida.

O aplicativo usa componentes nativos Android. Suas partidas, preferências e estatísticas ficam no próprio aparelho, separadas dos dados da versão web e sem sincronização entre as duas versões.

Veja [instalação e compilação do Android](docs/ANDROID.md), [processo de publicação](docs/RELEASE.md) e [avisos de terceiros](docs/THIRD_PARTY_NOTICES.md).

## Executar localmente

Requer **Node.js 20.19+ ou 22.12+** e npm.

```sh
npm install
npm run dev
```

Abra o endereço mostrado no terminal. O Vite tenta a porta `5173` e pode escolher a seguinte se ela estiver ocupada.

```sh
npm run build
npm run preview
```

O build gera os arquivos estáticos em `dist/`. O projeto funciona sem backend e sem conta de usuário.

## Como jogar

Escolha o idioma, um tamanho de **4 a 8 letras**, a dificuldade e o modo. Digite pelo teclado físico ou pelos botões da tela e pressione Enter. As cores indicam letra na posição correta, letra em outra posição ou letra ausente. Acentos e cedilha são normalizados, e as pistas respeitam a quantidade de letras repetidas.

| Modo | Desafio |
| --- | --- |
| Clássico | Uma palavra; novas partidas à vontade. |
| Desafio diário | Uma palavra por dia e combinação de idioma, tamanho e dificuldade. |
| Dueto | Duas palavras simultâneas; cada tentativa vale nos dois tabuleiros. |
| Quarteto | Quatro palavras simultâneas; cada tentativa vale nos quatro tabuleiros. |
| Blitz | Uma palavra em até 120 segundos, respeitando também o limite de tentativas. |

O desafio diário usa a **data local do navegador**. Para a mesma data, idioma, tamanho, dificuldade e versão dos dicionários, a palavra é a mesma. Uma partida diária concluída permanece disponível até a mudança do dia.

No Blitz, o relógio começa na primeira tentativa válida. O tempo continua passando ao mudar de aba ou recarregar a página; essas ações não reiniciam os 120 segundos.

| Dificuldade | Clássico, Diário e Blitz | Dueto | Quarteto | Respostas sorteadas |
| --- | ---: | ---: | ---: | --- |
| Aprendiz | 8 | 10 | 12 | Palavras comuns |
| Estrategista | 6 | 8 | 10 | Palavras comuns |
| Grão-mestre | 5 | 7 | 9 | Dicionário completo |

Dueto acrescenta duas tentativas à base; Quarteto acrescenta quatro. Tentativas válidas usam o dicionário completo em todas as dificuldades. Também há alto contraste, sons opcionais, estatísticas, histórico e compartilhamento do resultado sem revelar as respostas.

No Quarteto, os quatro tabuleiros ficam lado a lado. Em telas menores, a faixa permite rolagem horizontal e os atalhos numerados levam diretamente a cada tabuleiro. As configurações ficam abaixo da área de jogo.

As letras têm animação de entrada, as pistas são reveladas em sequência e as tentativas inválidas fazem a linha reagir sem consumir uma chance. Acertos recebem uma comemoração com peças de xadrez; as animações não bloqueiam a próxima tentativa, não são repetidas ao restaurar uma partida e respeitam a preferência de movimento reduzido do sistema.

## Palavras e progresso

- **Português:** 56.887 palavras únicas, incluindo 756 respostas comuns selecionadas.
- **Inglês:** 40.762 palavras únicas, incluindo 2.405 respostas comuns selecionadas.

Os dicionários de 4 a 8 letras acompanham a aplicação. Não há geração aleatória de palavras nem consulta a uma API de palavras durante as partidas. As fontes abertas têm licenças preservadas, revisões fixadas e verificações de integridade. Regionalismos e termos especializados podem aparecer, especialmente em Grão-mestre. O filtro de nomes próprios depende das informações presentes na fonte.

Consulte [fontes, licenças e critérios dos dicionários](docs/DICTIONARIES.md). Para reconstruir os dados a partir das fontes fixadas, com acesso à internet:

```sh
npm run words:build
```

Configurações, partidas e estatísticas ficam no `localStorage` deste navegador, separados por idioma, modo, dificuldade e tamanho. Não há sincronização entre dispositivos. Limpar os dados do site remove esse progresso.

## Verificar

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Os testes unitários usam Vitest. Os testes de navegador usam Playwright com Chromium e iniciam um servidor isolado na porta `5178`. Para escolher outra porta no PowerShell:

```powershell
$env:E2E_PORT = '5180'
npm run test:e2e
Remove-Item Env:E2E_PORT
```

O servidor de teste usa a porta indicada com `strictPort`; escolha uma porta livre.
