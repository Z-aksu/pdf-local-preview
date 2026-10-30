<script setup>
import { useI18n } from '../i18n.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { getNextMenuItemIndex } from '../tab-context-menu.js'

const { t } = useI18n()

const props = defineProps({
  tabs: { type: Array, required: true },
  activePath: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['select', 'close', 'open'])
const rootElement = ref(null)
const triggerElement = ref(null)
const panelElement = ref(null)
const isOpen = ref(false)
const itemElements = new Map()
const duplicateNames = computed(() => {
  const counts = new Map()
  for (const tab of props.tabs) counts.set(tab.name, (counts.get(tab.name) || 0) + 1)
  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name))
})

function setItemElement(path, element) {
  if (element) itemElements.set(path, element)
  else itemElements.delete(path)
}

function parentDirectory(path) {
  const normalizedPath = path.replace(/\\/g, '/')
  const separator = normalizedPath.lastIndexOf('/')
  return separator > 0 ? normalizedPath.slice(0, separator) : t('Root directory')
}

function focusItem(path) {
  const item = itemElements.get(path)
  item?.focus({ preventScroll: true })
  item?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function closeMenu(restoreFocus = false) {
  isOpen.value = false
  if (restoreFocus === true) triggerElement.value?.focus({ preventScroll: true })
}

async function openMenu(fromEnd = false) {
  if (props.disabled || !props.tabs.length) return
  isOpen.value = true
  emit('open')
  await nextTick()
  if (!isOpen.value || !panelElement.value) return
  const selected = props.tabs.find((tab) => tab.path === props.activePath)
  const fallback = fromEnd ? props.tabs[props.tabs.length - 1] : props.tabs[0]
  focusItem((selected || fallback)?.path)
}

function toggleMenu() {
  if (isOpen.value) closeMenu()
  else void openMenu()
}

function selectTab(path) {
  closeMenu()
  emit('select', path)
}

async function closeTab(path) {
  const index = props.tabs.findIndex((tab) => tab.path === path)
  if (index < 0) return
  emit('close', path)
  await nextTick()
  if (!rootElement.value || !isOpen.value) return
  if (!props.tabs.length) {
    closeMenu()
    return
  }
  focusItem(props.tabs[Math.min(index, props.tabs.length - 1)].path)
}

function handleMenuKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeMenu(true)
    return
  }
  const row = event.target.closest('.document-tab-picker-row')
  const items = [...panelElement.value.querySelectorAll('.document-tab-picker-item')]
  const currentIndex = items.findIndex((item) => row?.contains(item))
  if (event.key === 'Delete' && event.target.matches('.document-tab-picker-item')) {
    event.preventDefault()
    void closeTab(props.tabs[currentIndex]?.path)
    return
  }
  const nextIndex = getNextMenuItemIndex(currentIndex, items.length, event.key)
  if (nextIndex === null) return
  event.preventDefault()
  focusItem(props.tabs[nextIndex].path)
}

function handlePointerDown(event) {
  if (isOpen.value && !rootElement.value?.contains(event.target)) closeMenu()
}

function handleFocusOut(event) {
  if (event.relatedTarget && !rootElement.value?.contains(event.relatedTarget)) closeMenu()
}

watch(() => props.disabled, (disabled) => {
  if (disabled) closeMenu()
})

onMounted(() => {
  window.addEventListener('pointerdown', handlePointerDown)
  window.addEventListener('blur', closeMenu)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', handlePointerDown)
  window.removeEventListener('blur', closeMenu)
})
</script>

<template>
  <div ref="rootElement" class="document-tab-picker" @focusout="handleFocusOut">
    <button
      ref="triggerElement"
      class="document-tab-picker-trigger"
      :class="{ 'document-tab-picker-trigger--open': isOpen }"
      type="button"
      :disabled="disabled"
      :title="t(tabs.length === 1 ? 'View {count} open document' : 'View {count} open documents', { count: tabs.length })"
      :aria-label="t(tabs.length === 1 ? 'View {count} open document' : 'View {count} open documents', { count: tabs.length })"
      aria-haspopup="dialog"
      :aria-expanded="isOpen"
      aria-controls="document-tab-picker-panel"
      @click="toggleMenu"
      @keydown.down.prevent="openMenu()"
      @keydown.up.prevent="openMenu(true)"
      @keydown.esc.stop.prevent="closeMenu(true)"
    >
      <span>{{ tabs.length }}</span>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>

    <div
      v-if="isOpen"
      id="document-tab-picker-panel"
      ref="panelElement"
      class="document-tab-picker-panel"
      role="dialog"
      :aria-label="t('Open documents')"
      @keydown="handleMenuKeydown"
    >
      <div class="document-tab-picker-heading">
        <span>{{ t("Open documents") }}</span>
        <span>{{ tabs.length }}</span>
      </div>
      <ul class="document-tab-picker-list" :aria-label="t('Open document list')">
        <li
          v-for="tab in tabs"
          :key="tab.path"
          class="document-tab-picker-row"
          :class="{ 'document-tab-picker-row--active': tab.path === activePath }"
        >
          <button
            :ref="(element) => setItemElement(tab.path, element)"
            class="document-tab-picker-item"
            type="button"
            :title="tab.path"
            :aria-current="tab.path === activePath ? 'page' : undefined"
            @click="selectTab(tab.path)"
          >
            <svg class="document-tab-picker-check" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8 3 3 6-6" /></svg>
            <span class="document-tab-picker-text">
              <span class="document-tab-picker-name">{{ tab.name }}</span>
              <span v-if="duplicateNames.has(tab.name)" class="document-tab-picker-path">{{ parentDirectory(tab.path) }}</span>
            </span>
          </button>
          <button
            class="document-tab-picker-close"
            type="button"
            :aria-label="t('Close {name}', { name: tab.name })"
            :title="t('Close {name}', { name: tab.path })"
            @click="closeTab(tab.path)"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
