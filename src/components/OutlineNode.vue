<script setup>
import { computed, ref, watch } from 'vue'

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
        :aria-label="expanded ? `折叠 ${node.title}` : `展开 ${node.title}`"
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
        :title="node.pageNumber ? `跳转到第 ${node.pageNumber} 页` : '该节点没有可用的页内定位'"
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
