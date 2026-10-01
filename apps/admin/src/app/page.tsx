'use client';
import {Refine} from '@refinedev/core';
export default function Admin() {
  return <Refine resources={[{name:'events'},{name:'profiles'},{name:'cities'},{name:'dance-styles'},{name:'reports'}]}>
    <main style={{maxWidth:760,margin:'80px auto',padding:24}}>
      <p>dance community / admin</p><h1>Основа панели управления</h1>
      <p>Refine подключён. Доступ к данным и действиям будет открыт после подключения Better Auth и проверки ролей в E2 / E9.</p>
      <p>Сейчас эта страница не предоставляет административных операций.</p>
    </main>
  </Refine>;
}
