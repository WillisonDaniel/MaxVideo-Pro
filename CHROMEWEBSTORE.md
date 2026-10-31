# Chrome Web Store Listing — MaxVideo Pro

> Last Updated: 2026-10-27

## Store Listing

**Extension Name** [REQUIRED]
MaxVideo Pro — Maximizador de Vídeos & Janela Sem Abas

**Short Description** [REQUIRED]
Maximize qualquer vídeo para preencher a janela e oculte abas, barra de URL e favoritos com 1 clique (Modo Janela Limpa).

**Detailed Description** [REQUIRED]
Assista aos seus vídeos favoritos com máxima imersão e zero distrações na tela.

O MaxVideo Pro expande qualquer vídeo da web para preencher completamente a janela do seu navegador, permitindo ocultar a barra de guias, o campo de URL e os favoritos em uma janela flutuante e redimensionável.

Ao contrário do modo de tela cheia padrão que bloqueia todo o seu monitor, o MaxVideo Pro oferece o inovador Modo Janela Limpa: o vídeo se adapta livremente, permitindo que você organize sua área de trabalho, divida a tela lado a lado com anotações ou código, e trabalhe confortavelmente em múltiplos monitores sem barras de navegador tomando espaço.

Principais Recursos:
• Modo Janela Limpa (Pop-out): Remova abas, barra de endereço e favoritos instantaneamente com o atalho Alt + W ou com 1 clique.
• Maximização Inteligente: O vídeo preenche 100% da janela da página mantendo todas as legendas e os controles nativos do player perfeitamente funcionais.
• Eliminação de Barras Pretas: Modos de zoom para preencher (Zoom-to-Fill) perfeitos para monitores ultrawide (21:9) ou vídeos em formatos diferenciados.
• Controle de Velocidade Universal: Ajuste a velocidade de 0.25x até 5x em qualquer reprodutor HTML5.
• Amplificador de Volume: Aumente o som de vídeos com áudio baixo em até 300%.
• Ferramentas de Imagem: Espelhe o vídeo horizontalmente (ideal para treinos e aulas) ou gire em 90°.
• Picture-in-Picture Avançado: Destaque o vídeo para flutuar sobre qualquer outro aplicativo.
• Atalhos de Teclado Práticos: Controle tudo com rapidez sem tirar a mão do teclado.

Como Usar:
1. Abra qualquer página contendo um vídeo (YouTube, Twitch, cursos, transmissões ao vivo ou qualquer site com reprodutor de vídeo).
2. Pressione Alt + W para abrir diretamente na Janela Limpa sem abas nem barra de URL, ou passe o cursor sobre o vídeo para ver os botões rápidos.
3. Use o ícone da extensão na barra de ferramentas para alterar a proporção, a velocidade e o volume com um toque.
4. Para voltar ao formato comum de abas a qualquer momento, aperte Alt + W novamente ou a tecla Esc.

Privacidade e Transparência:
O MaxVideo Pro é executado 100% localmente no seu dispositivo. Ele não coleta, não armazena e não transmite nenhum dado pessoal, histórico de navegação ou informação confidencial.

Suporte e Feedback:
Dúvidas ou sugestões de melhorias? Nossa equipe está sempre aberta a aprimorar sua experiência de visualização.

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
Maximizar vídeos em reprodutores web e oferecer uma janela limpa sem abas, barra de endereço ou favoritos.

**Primary Language** [REQUIRED]
Portuguese (Brazil)

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | icons/icon-128.png |
| Screenshot 1 [REQUIRED] | 1280×800 or 640×400 | ⬜ Not created | |
| Screenshot 2 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not created | |
| Screenshot 3 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not created | |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | |

### Screenshot Notes
- Screenshot 1: Vídeo do YouTube expandido em Modo Janela Limpa com abas e URL ocultas ao lado de um editor de texto.
- Screenshot 2: Menu rápido flutuante (HUD) aparecendo suavemente no canto do reprodutor com os botões de ação rápida.
- Screenshot 3: Menu popup da extensão mostrando as ferramentas de proporção (Zoom Ultrawide), velocidade e amplificador de áudio.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `tabs` | permissions | Necessário para identificar e transferir a guia com o vídeo ativo entre a janela normal de navegação e a Janela Limpa sem abas, além de restaurá-la para a posição original quando solicitado. |
| `storage` | permissions | Utilizado exclusivamente para salvar as preferências locais do usuário (como visibilidade do menu flutuante, modo de zoom padrão e velocidade memorizada). |
| `contextMenus` | permissions | Permite ao usuário clicar com o botão direito sobre qualquer vídeo ou página para acionar diretamente o Modo Janela Limpa, Maximizar ou Picture-in-Picture. |
| `scripting` | permissions | Necessário para aplicar as alterações de visualização e redimensionamento no reprodutor de vídeo selecionado pelo usuário. |
| `downloads` | permissions | Permite salvar o arquivo de vídeo identificado diretamente no computador do usuário quando acionado o botão de download. |
| `<all_urls>` | host_permissions | Necessário para que o usuário possa maximizar e desfrutar do Modo Janela Limpa em qualquer reprodutor de vídeo da internet (YouTube, plataformas de aulas, streaming e sites de notícias). |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL** [REQUIRED]
https://github.com/maxvideopro/privacy-policy

## Distribution

**Visibility**: Public
**Regions**: All regions

## Developer Info

**Publisher Name** [REQUIRED]
MaxVideo Team

**Contact Email** [REQUIRED]
support@maxvideo.dev

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.0.0 | 2026-10-27 | Versão inicial com Modo Janela Limpa sem abas/URL, HUD flutuante, proporção ultrawide, controle de velocidade e amplificador de áudio. | Draft |

## Review Notes

### Known Issues / Limitations
- Em páginas do sistema do navegador (`chrome://` ou `edge://`), extensões são restritas por segurança do Chromium.
- Amplificação de áudio superior a 100% depende de fontes de mídia que permitam contexto Web Audio local.
