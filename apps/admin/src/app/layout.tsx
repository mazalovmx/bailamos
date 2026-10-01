export const metadata = {title: 'Dance Community · Admin'};
export default function Layout({children}: {children: React.ReactNode}) {
  return <html lang="ru"><body style={{fontFamily:'sans-serif',background:'#f6f4ee',color:'#202822',margin:0}}>{children}</body></html>;
}
