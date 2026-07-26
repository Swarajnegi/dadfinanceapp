import re

def main():
    with open('web/index_old.html', 'r', encoding='utf-8') as f:
        old_html = f.read()
        
    with open('web/index.html', 'r', encoding='utf-8') as f:
        new_html = f.read()

    # Extract Add Investment Form
    add_form_start = old_html.find('<!-- Add Investment Form -->')
    add_form_end = old_html.find('<!-- Investments Table -->')
    add_form = old_html[add_form_start:add_form_end]

    # Extract Edit Modal
    edit_modal_start = old_html.find('<!-- ── EDIT INVESTMENT MODAL (Deliverable 1) ── -->')
    edit_modal_end = old_html.find('<!-- ┌──────────────────────────────────────────────┐', edit_modal_start)
    
    # refine edit_modal_end to just be the end of the div
    edit_modal = old_html[edit_modal_start:edit_modal_end]
    
    # We will wrap the Add Form in a modal as well for the new UI, or just slap it at the bottom.
    # Actually, the user can just use the FAB to trigger the Add Investment form.
    # Let's create an Add Investment Modal in Alpine JS
    add_modal = add_form.replace('<div class="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">', 
                                 '<div x-show="addingInv" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" x-cloak><div class="bg-[#051424] border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl p-6 text-white relative"><button @click="addingInv = false" class="absolute top-4 right-4 text-white/50 hover:text-white">✕</button>')
    add_modal += '</div></div>'
    
    edit_modal = edit_modal.replace('bg-white', 'bg-[#051424] border border-white/10').replace('text-slate-800', 'text-white').replace('text-slate-600', 'text-white/70')

    # Append before </body>
    modals = f"\n{add_modal}\n{edit_modal}\n"
    new_html = new_html.replace('</body>', f'{modals}\n</body>')

    # Update FAB to toggle Add Investment
    new_html = new_html.replace('@click="activePage = \'investments\'"', '@click="addingInv = true; activePage = \'investments\'"')

    with open('web/index.html', 'w', encoding='utf-8') as f:
        f.write(new_html)
        
    print("Modals copied.")

if __name__ == '__main__':
    main()
