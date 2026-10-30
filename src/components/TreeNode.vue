<script setup>
import { useI18n } from '../i18n.js'
import { computed } from 'vue'

const { t } = useI18n()

const props = defineProps({
  node: {
    type: Object,
    required: true,
  },
  selectedPath: {
    type: String,
    default: '',
  },
  depth: {
    type: Number,
    default: 0,
  },
  collapsedPaths: {
    type: Set,
    default: () => new Set(),
  },
  favoritePaths: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['select', 'toggle-directory', 'toggle-favorite'])
const expanded = computed(() => !props.collapsedPaths.has(props.node.path))
const isFavorite = computed(() => props.favoritePaths.includes(props.node.path))

const fileCount = computed(() => {
  if (props.node.type === 'file') return 1
  return props.node.children.reduce((count, child) => {
    if (child.type === 'file') return count + 1
    const countBranch = (node) => node.children.reduce(
      (sum, entry) => sum + (entry.type === 'file' ? 1 : countBranch(entry)),
      0,
    )
    return count + countBranch(child)
  }, 0)
})

function selectNode() {
  if (props.node.type === 'directory') {
    emit('toggle-directory', {
      path: props.node.path,
      expanded: !expanded.value,
    })
    return
  }
  emit('select', props.node)
}
</script>

<template>
  <li class="tree-node">
    <button
      v-if="node.type === 'directory'"
      class="tree-row"
      :style="{ '--tree-depth': depth }"
      :aria-expanded="expanded"
      :title="node.path"
      type="button"
      @click="selectNode"
    >
      <svg
        class="tree-chevron"
        :class="{ 'tree-chevron--open': expanded }"
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <path d="m6 3.5 4.5 4.5L6 12.5" />
      </svg>
      <svg class="tree-icon tree-icon--folder" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M2.5 5.5a2 2 0 0 1 2-2h3l1.7 2h6.3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z" />
      </svg>

      <span class="tree-label">{{ node.name }}</span>
      <span class="tree-count">{{ fileCount }}</span>
    </button>

    <div
      v-else
      class="tree-file-entry"
      :class="{ 'tree-file-entry--selected': node.path === selectedPath }"
      :style="{ '--tree-depth': depth }"
    >
      <button
        class="tree-row tree-row--file"
        :class="{ 'tree-row--selected': node.path === selectedPath }"
        :aria-current="node.path === selectedPath ? 'page' : undefined"
        :title="node.path"
        type="button"
        @click="selectNode"
      >
        <span class="tree-chevron-spacer" />
        <svg class="tree-icon tree-icon--pdf" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 2.5h6l4 4v11H5z" />
          <path d="M11 2.5v4h4M7.2 13.5h5.6M7.2 10.5h3.7" />
        </svg>
        <span class="tree-label">{{ node.name }}</span>
      </button>
      <button
        class="tree-favorite-button"
        :class="{ 'tree-favorite-button--active': isFavorite }"
        type="button"
        :title="t(isFavorite ? 'Remove {name} from favorites' : 'Add {name} to favorites', { name: node.name })"
        :aria-label="t(isFavorite ? 'Remove {name} from favorites' : 'Add {name} to favorites', { name: node.name })"
        :aria-pressed="isFavorite"
        @click="emit('toggle-favorite', node)"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="m10 2.7 2.2 4.45 4.9.71-3.55 3.46.84 4.88L10 13.9 5.61 16.2l.84-4.88L2.9 7.86l4.9-.71z" />
        </svg>
      </button>
    </div>

    <ul v-if="node.type === 'directory' && expanded" class="tree-children">
      <TreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :selected-path="selectedPath"
        :depth="depth + 1"
        :collapsed-paths="collapsedPaths"
        :favorite-paths="favoritePaths"
        @select="emit('select', $event)"
        @toggle-directory="emit('toggle-directory', $event)"
        @toggle-favorite="emit('toggle-favorite', $event)"
      />
    </ul>
  </li>
</template>
