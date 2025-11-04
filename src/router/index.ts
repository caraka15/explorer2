import { useBlockchain } from '@/stores';
import { createRouter, createWebHistory } from 'vue-router';
// @ts-ignore
import { setupLayouts } from 'virtual:generated-layouts';
// @ts-ignore
import routes from '~pages';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [...setupLayouts(routes)],
});

//update current blockchain
router.beforeEach(async (to) => {
  const { chain } = to.params;
  if (!chain) return;

  const blockchain = useBlockchain();
  const requestedChain = chain.toString();
  const normalizedChain = await blockchain.setCurrent(requestedChain);

  if (!normalizedChain || normalizedChain === requestedChain) return;

  const normalizedPath = to.path.replace(/^\/[^/]+/, `/${normalizedChain}`);
  return {
    path: normalizedPath,
    query: to.query,
    hash: to.hash,
    replace: true,
  };
});

// Docs: https://router.vuejs.org/guide/advanced/navigation-guards.html#global-before-guards

export default router;
