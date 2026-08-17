import { Component, Listen, h } from '@stencil/core';

@Component({
  tag: 'leak-cmp',
  shadow: true,
})
export class LeakCmp {
  @Listen('resize', { target: 'window' })
  handleResize() {
    // no-op, just here to force a window-targeted listener during hydrate
  }

  @Listen('scroll', { target: 'document' })
  handleScroll() {
    // no-op, just here to force a document-targeted listener during hydrate
  }

  render() {
    return <div>leak-cmp</div>;
  }
}
