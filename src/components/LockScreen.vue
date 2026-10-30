<script setup>
import { useI18n } from '../i18n.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const { t, locale } = useI18n()

const props = defineProps({
  ready: Boolean,
  loading: Boolean,
  configError: { type: String, default: '' },
  error: { type: String, default: '' },
  busy: Boolean,
  passwordRequired: { type: Boolean, default: true },
})
const emit = defineEmits(['unlock', 'retry'])
const dialogElement = ref(null)
const passwordElement = ref(null)
const password = ref('')
const entryOpen = ref(false)
const now = ref(new Date())
let clockTimer = null

const timeLabel = computed(() => now.value.toLocaleTimeString(locale.value, {
  hour: '2-digit', minute: '2-digit', hour12: false,
}))
const dateLabel = computed(() => now.value.toLocaleDateString(locale.value, {
  month: 'long', day: 'numeric', weekday: 'long',
}))
const monthLabel = computed(() => now.value.toLocaleDateString(locale.value, {
  year: 'numeric', month: 'long',
}))
const monthCaption = computed(() => now.value.toLocaleDateString(locale.value, {
  month: 'long', year: 'numeric',
}).toUpperCase())
const calendarDays = computed(() => {
  const year = now.value.getFullYear()
  const month = now.value.getMonth()
  const offset = (new Date(year, month, 1).getDay() + 6) % 7
  const count = new Date(year, month + 1, 0).getDate()
  return [...Array(offset).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)]
})

function focusEntry() {
  nextTick(() => {
    if (entryOpen.value && props.passwordRequired) passwordElement.value?.focus({ preventScroll: true })
    else dialogElement.value?.focus({ preventScroll: true })
  })
}

function handleClockClick() {
  if (!props.ready || props.busy) return
  if (!props.passwordRequired) {
    submitPassword()
    return
  }
  entryOpen.value = true
  focusEntry()
}

function submitPassword() {
  if (!props.ready || props.busy || (props.passwordRequired && !password.value)) return
  emit('unlock', password.value)
  password.value = ''
}

function handleKeydown(event) {
  if (!props.ready || props.busy || event.isComposing) return
  if (event.key === 'Escape') {
    event.preventDefault()
    entryOpen.value = false
    password.value = ''
    focusEntry()
    return
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (['INPUT', 'TEXTAREA', 'BUTTON'].includes(event.target?.tagName) || event.target?.isContentEditable) return
  if (event.key === 'Enter') {
    event.preventDefault()
    submitPassword()
  } else if (event.key === 'Backspace') {
    event.preventDefault()
    password.value = password.value.slice(0, -1)
  } else if (event.key.length === 1) {
    event.preventDefault()
    password.value += event.key
  }
}

onMounted(() => {
  // The top layer also covers native fullscreen without unmounting the reader.
  dialogElement.value.showModal()
  focusEntry()
  clockTimer = window.setInterval(() => { now.value = new Date() }, 1000)
})
onBeforeUnmount(() => {
  window.clearInterval(clockTimer)
  dialogElement.value?.close()
})
watch(() => props.busy, (busy) => { if (!busy) focusEntry() })
watch(() => props.passwordRequired, () => {
  entryOpen.value = false
  password.value = ''
  focusEntry()
})
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialogElement"
      class="lock-screen"
      tabindex="-1"
      :aria-label="t('Date and time')"
      @cancel.prevent
      @keydown.stop="handleKeydown"
    >
      <header class="desk-header">
        <span class="desk-brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
        <span class="desk-header-date">{{ monthCaption }}</span>
      </header>

      <main class="desk-main">
        <div class="desk-paper">
          <section class="desk-clock-card" :aria-label="t('Current time')">
            <span class="desk-eyebrow">{{ monthCaption }}</span>
            <button class="desk-clock" type="button" :aria-label="t('Current time')" :aria-expanded="passwordRequired ? entryOpen : undefined" :disabled="!ready || busy" @click="handleClockClick">
              <time>{{ timeLabel }}</time>
            </button>
            <div class="desk-clock-bottom"><span class="desk-date-rule" /><span>{{ dateLabel }}</span></div>
            <div class="desk-clock-art" aria-hidden="true"><span /><span /><span /></div>
          </section>

          <section class="desk-calendar-card" :aria-label="t('Monthly calendar')">
            <div class="desk-card-heading"><strong>{{ monthLabel }}</strong><span class="desk-calendar-mark" aria-hidden="true">·</span></div>
            <div class="desk-calendar-week"><span v-for="day in ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']" :key="day">{{ t(day) }}</span></div>
            <div class="desk-calendar-days">
              <span v-for="(day, index) in calendarDays" :key="index" :class="{ 'desk-calendar-today': day === now.getDate() }" :aria-current="day === now.getDate() ? 'date' : undefined">{{ day }}</span>
            </div>
          </section>
        </div>
        <div class="desk-paper-foot" aria-hidden="true"><span /><i /><span /></div>
      </main>

      <div v-if="entryOpen || !ready || error" class="desk-entry-panel">
        <form v-if="ready && entryOpen && passwordRequired" class="lock-screen-form" :aria-busy="busy" @submit.prevent="submitPassword">
          <input id="lock-screen-password" ref="passwordElement" v-model="password" name="entry" type="password" inputmode="numeric" autocomplete="off" :aria-label="t('Password')" placeholder="····" :disabled="busy" required>
          <button class="desk-entry-submit" type="submit" :aria-label="t('Continue')" :disabled="busy || !password">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5" /></svg>
          </button>
        </form>
        <p v-if="ready && error" class="desk-entry-error" role="alert">{{ error }}</p>
        <template v-if="!ready">
          <p v-if="configError" class="desk-entry-error" role="alert">{{ t("Unable to connect. Please try again.") }}</p>
          <p v-if="loading" class="desk-entry-status" role="status">{{ t("Getting ready…") }}</p>
          <button v-else class="desk-entry-submit desk-retry" type="button" @click="emit('retry')">{{ t("Retry") }}</button>
        </template>
      </div>
    </dialog>
  </Teleport>
</template>
