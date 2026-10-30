<script setup>
import { useI18n } from '../i18n.js'
import { computed, ref, watch } from 'vue'

const { t } = useI18n()

const props = defineProps({
  node: {
    type: Object,
    required: true,
  },
  depth: {
    type: Number,
    default: 0,
  },
  expansionCommand: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['select'])
const expanded = ref(true)
const hasChildren = computed(() => props.node.items?.length > 0)

watch(
  () => props.expansionCommand,
  (command) => {
    if (hasChildren.value && command) {
      expanded.value = command.expanded
    }
  },
  { immediate: true },
)

function selectNode() {
  if (!props.node.pageNumber) return
  emit('select', props.node)
}

function toggleNode(event) {
  event.stopPropagation()
  if (hasChildren.value) expanded.value = !expanded.value
}
</script>

<template>
  <li class="outline-node">
    <div class="outline-entry" :style="{ '--outline-depth': depth }">
      <button
        v-if="hasChildren"
        class="outline-chevron"
        :class="{ 'outline-chevron--open': expanded }"
        type="button"
        :aria-expanded="expanded"
        :aria-label="t(expanded ? 'Collapse {name}' : 'Expand {name}', { name: node.title })"
        @click="toggleNode"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
      </button>
      <span v-else class="outline-chevron-spacer" aria-hidden="true" />

      <button
        class="outline-row"
        :class="{
          'outline-row--available': node.pageNumber,
          'outline-row--unavailable': !node.pageNumber,
        }"
        :title="node.pageNumber ? t('Go to page {number}', { number: node.pageNumber }) : t('No page destination available')"
        type="button"
        :disabled="!node.pageNumber"
        @click="selectNode"
      >
        <span class="outline-page" aria-hidden="true">{{ node.pageNumber || '·' }}</span>
        <span class="outline-label">{{ node.title }}</span>
      </button>
    </div>

    <ul v-if="hasChildren && expanded" class="outline-children">
      <OutlineNode
        v-for="child in node.items"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :expansion-command="expansionCommand"
        @select="emit('select', $event)"
      />
    </ul>
  </li>
</template>
