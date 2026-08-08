import type { ReactNode } from 'react';
import { Layout, Navbar } from 'nextra-theme-docs';
import { Head } from 'nextra/components';
import { getPageMap } from 'nextra/page-map';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import { ThemeProvider } from '@mui/material/styles';
import { muiTheme } from '../lib/mui-theme';
import 'nextra-theme-docs/style.css';
import './tailwind.css';
import { Geist } from 'next/font/google';
import { cn } from '@/lib/utils';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export const metadata = {
  title: {
    template: '%s – omnireact',
    default: 'omnireact',
  },
  description: 'omnireact — a collection of independent, headless React packages.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const navbar = <Navbar logo={<b>Omnireact</b>} />;
  const pageMap = await getPageMap();

  return (
    <html lang="en" dir="ltr" suppressHydrationWarning className={cn('font-sans', geist.variable)}>
      <Head />
      <body>
        <AppRouterCacheProvider options={{ enableCssLayer: true }}>
          <ThemeProvider theme={muiTheme}>
            <Layout
              navbar={navbar}
              docsRepositoryBase="https://github.com/jakhang/omnireact/tree/main/apps/docs"
              pageMap={pageMap}
              toc={{ backToTop: false }}
            >
              {children}
            </Layout>
          </ThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
