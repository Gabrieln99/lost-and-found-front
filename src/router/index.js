import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/create-listing',
      name: 'create-listing',
      component: () => import('../views/CreateListingView.vue'),
    },
    {
      path: '/browse',
      name: 'browse-listings',
      component: () => import('../views/BrowseListingsView.vue'),
    },
    {
      path: '/profile',
      name: 'profile',
      component: () => import('../views/ProfileView.vue'),
    },
  ],
})

export default router
