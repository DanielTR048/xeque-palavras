# Avisos de terceiros

Este documento identifica componentes e dados de terceiros distribuídos pelo Xeque. Os textos completos das licenças foram preservados nos arquivos indicados. Esses avisos não definem uma licença para o código original do aplicativo.

| Componente | Uso | Licença / aviso preservado |
| --- | --- | --- |
| React 19.3.0 | Interface web | [MIT, Meta Platforms e afiliadas](../public/licenses/LICENSE-React.txt) |
| React DOM 19.3.0 | Renderização web | [MIT, Meta Platforms e afiliadas](../public/licenses/LICENSE-React-DOM.txt) |
| Scheduler 0.28.0 | Agendamento interno do React DOM | [MIT, Meta Platforms e afiliadas](../public/licenses/LICENSE-Scheduler.txt) |
| Lucide React 0.577.0 | Ícones web | [ISC e avisos de partes derivadas de Feather/MIT](../public/licenses/LICENSE-Lucide.txt) |
| DM Sans | Fonte web, pacote `@fontsource-variable/dm-sans` | [SIL Open Font License 1.1](../public/fonts/LICENSE-DM-Sans.txt) |
| Libre Caslon Display | Fonte web, pacote `@fontsource/libre-caslon-display` | [SIL Open Font License 1.1](../public/fonts/LICENSE-Libre-Caslon-Display.txt) |
| fserb/pt-br | Dicionário português web e Android | [MIT, Fernando Serboncini](../public/dictionaries/LICENSE-pt.txt) |
| ESDB / SCOWL | Dicionário inglês web e Android | [Licença permissiva e avisos completos de origem](../public/dictionaries/LICENSE-en.txt) |
| Kotlin 2.2.21 | Aplicativo Android | [Apache License 2.0](../public/licenses/LICENSE-Kotlin.txt) e [NOTICE original](../public/licenses/NOTICE-Kotlin.txt) |

As licenças de React, React DOM, Scheduler e Lucide foram copiadas integralmente dos pacotes instalados com `package-lock.json`. Os arquivos de fontes preservam os avisos de seus autores. As dependências e ferramentas de desenvolvimento mantêm suas próprias licenças nos respectivos pacotes e repositórios.

A licença e o NOTICE de Kotlin foram obtidos da [versão oficial v2.2.21](https://github.com/JetBrains/kotlin/tree/v2.2.21/license). O NOTICE é o aviso original da distribuição Kotlin e está preservado sem alterações. O aplicativo utiliza a biblioteca padrão Kotlin, não redistribui o compilador no APK.

Os dicionários usam revisões fixadas e checksums documentados em [DICTIONARIES.md](DICTIONARIES.md). A normalização e os complementos editoriais aplicados às listas estão descritos ali.

## Distribuição

O Vite copia `public/licenses/`, `public/fonts/` e os avisos em `public/dictionaries/` para a saída web. O script `scripts/prepare-android-assets.mjs` copia os dicionários e as licenças de dados e Kotlin para `android/app/src/main/assets/`, para que acompanhem o APK.

A interface Android usa fontes e componentes da plataforma Android, sem incorporar as fontes ou bibliotecas de interface web ao APK. JUnit é utilizado apenas nos testes do projeto Android.

Ao atualizar dependências ou trocar fontes, atualize também os textos de licença e este inventário. Não remova os avisos dos titulares dos componentes de terceiros.
