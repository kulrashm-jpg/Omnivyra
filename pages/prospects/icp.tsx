/**
 * A2 — the ICP review workspace page.
 *
 * A route shell. All behaviour lives in `components/prospects/icp/IcpWorkspace`,
 * which is A2's owned surface; this file exists so the workspace has a canonical
 * address rather than being reachable only from another screen's state.
 */

import React from 'react';
import Head from 'next/head';
import IcpWorkspace from '@/components/prospects/icp/IcpWorkspace';

export default function ProspectIcpPage() {
  return (
    <>
      <Head><title>Ideal Customer Profile · Omnivyra</title></Head>
      <main>
        <IcpWorkspace />
      </main>
    </>
  );
}
