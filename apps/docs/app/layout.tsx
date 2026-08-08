import type { ReactNode } from 'react';
import { Footer, Layout, Navbar } from 'nextra-theme-docs';
import { Head } from 'nextra/components';
import { getPageMap } from 'nextra/page-map';
import 'nextra-theme-docs/style.css';
import './tailwind.css';

export const metadata = {
  title: {
    template: '%s – omnireact',
    default: 'omnireact',
  },
  description: 'omnireact — a collection of independent, headless React packages.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const navbar = <Navbar logo={<b>omnireact</b>} />;
  const pageMap = await getPageMap();

  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head />
      <body>
        <Layout
          navbar={navbar}
          footer={<Footer>MIT {new Date().getFullYear()} © jakhang.</Footer>}
          docsRepositoryBase="https://github.com/jakhang/omnireact/tree/main/apps/docs"
          pageMap={pageMap}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
