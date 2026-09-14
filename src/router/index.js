import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
      meta: { title: 'Lost & Found' },
    },
    {
      path: '/create-listing',
      name: 'create-listing',
      component: () => import('../views/CreateListingView.vue'),
      meta: { title: 'Lost & Found - Publish' },
    },
    {
      path: '/browse',
      name: 'browse-listings',
      component: () => import('../views/BrowseListingsView.vue'),
      meta: { title: 'Lost & Found - Browse' },
    },
    {
      path: '/listing/:id',
      name: 'listing-detail',
      component: () => import('../views/ListingDetailView.vue'),
      meta: { title: 'Lost & Found - Listing' },
    },
    {
      path: '/profile',
      name: 'profile',
      component: () => import('../views/ProfileView.vue'),
      meta: { title: 'Lost & Found - My Profile' },
    },
  ],
})

router.afterEach((to) => {
  document.title = to.meta.title ?? 'Lost & Found'
})

export default router
