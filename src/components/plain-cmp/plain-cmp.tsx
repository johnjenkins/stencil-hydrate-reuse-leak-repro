import { Component, h } from '@stencil/core';

@Component({
  tag: 'plain-cmp',
  shadow: true,
})
export class PlainCmp {
  render() {
    return <div>plain-cmp</div>;
  }
}
