// @ts-check
import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Where Winds Meed - Event Manager Bot',
  tagline: 'Documentation du bot Where Winds Meet - Event Manager',
  favicon: 'img/favicon.ico',
  url: 'https://wwm-discord-emb.vercel.app/', //URL Vercel du bot
  baseUrl: '/',
  organizationName: 'Iron Racletteurs',
  projectName: 'Where Winds Meet - Event Manager Bot',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  presets: [
    [
      'classic',
      ({
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.js',
          editUrl: 'https://github.com/Iron-Raclette/WWM_Discord_EMB/tree/main'
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],
  themeConfig:
    ({
      image: 'img/logo.png',
      navbar: {
        title: 'Where Winds Meet - Event Manager Bot',
        logo: {
          alt: 'Logo de raclette',
          src: 'img/logo.png',
        },
        items: [
          {
            to: '/dashboard',
            position: 'left',
            label: 'Dashboard',
          },
          {
            type: 'docSidebar',
            sidebarId: 'docSidebar',
            position: 'left',
            label: 'Documentation',
          },          {
            href: 'https://github.com/Iron-Raclette/WWM_Discord_EMB',
            label: 'GitHub',
            position: 'right',
          }
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              {
                label: 'Dashboard',
                to: '/dashboard',
              },
              {
                label: 'Guides',
                to: '/guides/guides',
              },
              {
                label: 'Commands',
                to: '/commands',
              }
            ],
          },        ],
      },
      colorMode: {
        defaultMode: 'dark',
        disableSwitch: true,
        respectPrefersColorScheme: false
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
};

export default config;
